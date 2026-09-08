//! The desktop half of the `CorpusEngine` port: the Scripture Kitchen engine,
//! native, with rayon mapping chapters.
//!
//! Sefer parses USFM in exactly one place, and on the keystroke path that place
//! is the wasm handle in the webview — synchronous, in-process, no IPC. This
//! module is the OTHER half of that handle. `Expediter::publish` maps every
//! changed chapter and judges every book in the project; on Web that runs on
//! the same thread that paints the editor, and it is the one cold path a
//! translator can feel. Here it runs on a thread of its own, in a build with
//! the engine's `parallel` feature, so the chapter map goes wide on rayon's
//! global pool.
//!
//! The published bytes are IDENTICAL to the wasm door's. That is held by the
//! engine's own tests, not by hope: `galley/src/wasm.md` ("The claim") pins the
//! native `Expediter`, the wasm `Galley` handle and the JS reader against one
//! set of golden buffers, and `galley/tests/equivalence.rs` pins the parallel
//! chapter map against the serial one. So `FindingsSnapshot.open` in
//! `src/platform/tauri/corpus.ts` reads what comes out of here with the same
//! reader it uses on Web.
//!
//! WHY A THREAD AND NOT A MUTEX. `Expediter<Brigade>` is deliberately not
//! `Send`: its chunk cache shares one chapter's products between books through
//! `Rc`, which is the right choice for a structure with a single owner and is
//! why the engine costs nothing for thread-safety it does not need (rayon
//! enters inside `publish`, over a local slice of chapters, and never over the
//! Expediter itself). So the corpus cannot be handed between threads at all —
//! it gets ONE owner thread for the life of the process, and every command
//! posts a closure to it and awaits the answer. That is also strictly better
//! than a lock: a `Mutex` on a tokio worker would block that worker for the
//! length of a publication.
//!
//! The command set mirrors `galley/src/wasm.rs` exactly — `update`,
//! `update_reference`, `remove`, `publish`, `find`, `resident_bytes` — because
//! the two doors must not drift. Judging knobs deliberately stay on the wasm handle:
//! they are read and written by the shell's settings surface, and a knob that
//! lived in two places would be a knob that disagreed with itself.

use tauri::async_runtime::{channel, Sender};
use tauri::ipc::Response;

use sous_core::Brigade;
use usfm_galley::{BookId, Expediter, Find, Retain, Role};

use crate::errors::{fail, ENGINE, IO};

/// Resident products the Pantry may hold before it starts shedding.
///
/// Four times the wasm door's 16 MB. The wasm budget is a permanent high-water
/// mark because linear memory grows and never shrinks; a native process has no
/// such trap, and a desktop machine opening a full New Testament would rather
/// keep its warm chunks than re-derive them.
const BUDGET_BYTES: usize = 64 << 20;

/// Queued jobs before a caller waits. The real caller is one debounced
/// scheduling fiber in `ProjectAnalysis` issuing a burst of `update`s and one
/// `publish`, so anything above a project's worth of books is slack.
const QUEUE_DEPTH: usize = 128;

/// One unit of work on the corpus, as a closure the owner thread runs.
///
/// A closure rather than a message enum: the reply channel then lives in the
/// closure that produces the answer, so adding a door is one command and no
/// new variant, and there is no way to reply with the wrong shape.
type Job = Box<dyn FnOnce(&mut Expediter<Brigade>) + Send>;

/// The handle the Tauri commands hold: a queue into the corpus thread.
///
/// `Sender` is `Send + Sync + Clone`, which is what `manage` requires — the
/// non-`Send` engine stays on the far side of it and is never named here.
pub struct CorpusState {
    jobs: Sender<Job>,
}

impl CorpusState {
    /// Spawns the corpus thread and returns the queue into it. The thread lives
    /// as long as the process; it ends when the last sender is dropped.
    pub fn new() -> Self {
        let (jobs, mut inbox) = channel::<Job>(QUEUE_DEPTH);
        std::thread::Builder::new()
            .name("sefer-corpus".into())
            .spawn(move || {
                // The corpus, resident: one Expediter, one Pantry inside it,
                // one publication out. Created HERE, on the thread that owns
                // it, because it can never be moved to another.
                let mut sous = Expediter::new(Brigade::default(), BUDGET_BYTES);
                while let Some(job) = inbox.blocking_recv() {
                    job(&mut sous);
                }
            })
            .expect("the corpus thread could not be spawned");
        Self { jobs }
    }
}

impl Default for CorpusState {
    fn default() -> Self {
        Self::new()
    }
}

/// The corpus thread is not there to answer. Either it panicked inside the
/// engine or the process is shutting down; neither is recoverable here, and the
/// TS side keeps its last snapshot rather than reporting a clean project.
fn gone() -> String {
    fail(IO, "the corpus thread is not answering")
}

/// Post one job to the corpus thread and await its answer.
///
/// Both hops are `.await`, never a blocking wait: the tokio worker this command
/// runs on is released while the engine works, which is the entire point of
/// moving the publication off the webview's thread in the first place.
async fn ask<R>(
    state: &tauri::State<'_, CorpusState>,
    work: impl FnOnce(&mut Expediter<Brigade>) -> R + Send + 'static,
) -> Result<R, String>
where
    R: Send + 'static,
{
    let (reply, mut answer) = channel::<R>(1);
    let job: Job = Box::new(move |sous| {
        // The receiver is gone only if the caller was cancelled; dropping the
        // answer is then correct, and the work is already done either way.
        let _ = reply.blocking_send(work(sous));
    });
    state.jobs.send(job).await.map_err(|_| gone())?;
    answer.recv().await.ok_or_else(gone)
}

/// Register or replace one whole book as a proofreading target, by the caller's
/// own id. Answers the `\id` line's canonical book code — `"MRK"` — which is
/// what orders the publication. Idempotent: the same text costs a checksum.
///
/// `text` must be canonical LF; `Source` refuses a carriage return on the way
/// in and on every edit, so by the time it reaches here that is a caller bug,
/// and the engine says so rather than guessing.
#[tauri::command]
pub async fn corpus_update(
    state: tauri::State<'_, CorpusState>,
    id: String,
    text: String,
) -> Result<String, String> {
    ask(&state, move |sous| {
        sous.update(id.as_str(), Role::Target, text.as_str())
            .map(|key| key.to_string())
            .map_err(|error| fail(ENGINE, error.to_string()))
    })
    .await?
}

/// The same, as a declared source: one projected grapheme length per verse and
/// no text at all. A reference publishes no findings of its own; it is the
/// denominator the length lane compares a target's verses against.
#[tauri::command]
pub async fn corpus_update_reference(
    state: tauri::State<'_, CorpusState>,
    id: String,
    text: String,
) -> Result<String, String> {
    ask(&state, move |sous| {
        sous.update_with(
            id.as_str(),
            Role::Reference,
            Retain::ProductsOnly,
            text.as_str(),
        )
        .map(|key| key.to_string())
        .map_err(|error| fail(ENGINE, error.to_string()))
    })
    .await?
}

/// Drop a book, its text and its cached rows. `false` when the id was never
/// registered — which is the answer, not a failure.
#[tauri::command]
pub async fn corpus_remove(
    state: tauri::State<'_, CorpusState>,
    id: String,
) -> Result<bool, String> {
    ask(&state, move |sous| sous.remove(&BookId::from(id.as_str()))).await
}

/// One complete corpus publication over every target, in canonical book order,
/// in raw-book UTF-16 — the buffer `FindingsSnapshot.open` reads.
///
/// Returned as a raw `ipc::Response` rather than a serialisable value: the
/// buffer is tens to hundreds of kilobytes of fixed-width rows, and
/// JSON-encoding it into an array of numbers would cost more than the
/// publication it carries. The webview receives an `ArrayBuffer`.
#[tauri::command]
pub async fn corpus_publish(state: tauri::State<'_, CorpusState>) -> Result<Response, String> {
    let bytes = ask(&state, |sous| {
        sous.publish()
            .map_err(|error| fail(ENGINE, error.to_string()))
    })
    .await??;
    Ok(Response::new(bytes))
}

/// Every hit of a literal `needle` over every registered book's verse-text
/// projection, in canonical book order, as the find buffer
/// (`galley/src/wasm.md`, "The find buffer").
///
/// The search runs HERE rather than in the webview for the same reason the
/// publication does: this is where the retained texts and masks are. The
/// webview holds a book's text too, but only the corpus holds the projection
/// every hit is placed in, and re-deriving 66 of those in JavaScript to search
/// them would be the cold path this module exists to avoid.
///
/// Raw `ipc::Response` bytes, like `corpus_publish`: the buffer is fixed-width
/// `u32` records, and JSON-encoding it into an array of numbers would cost
/// more than the search that produced it. Answered by the same
/// `decodeHits` the wasm door's buffer goes through — one format, two doors.
///
/// `limit` bounds hits across the whole corpus, not per book; `0` means no
/// bound. Literal only: there is no regex on this side of the wall.
#[tauri::command]
pub async fn corpus_find(
    state: tauri::State<'_, CorpusState>,
    needle: String,
    case_sensitive: bool,
    whole_word: bool,
    limit: u32,
) -> Result<Response, String> {
    let bytes = ask(&state, move |sous| {
        // Collected before the search so the registry's borrow ends: `find`
        // takes the Pantry mutably to read each book's retained projection.
        let ids: Vec<BookId> = sous
            .pantry()
            .books(Role::Target)
            .iter()
            .map(|(id, _)| id.clone())
            .collect();
        let find = Find::literal(needle.as_str())
            .case_insensitive(!case_sensitive)
            .whole_word(whole_word);
        sous.find(&find, &ids, limit)
    })
    .await?;
    Ok(Response::new(bytes))
}

/// Resident bytes across the whole handle: the Pantry's texts and products, and
/// the Expediter's own cached rows. Telemetry, not contract.
#[tauri::command]
pub async fn corpus_resident_bytes(state: tauri::State<'_, CorpusState>) -> Result<u64, String> {
    ask(&state, |sous| sous.resident_bytes() as u64).await
}
