//! The desktop half of the `Credentials` port, over the OS keychain.
//!
//! The Web host keeps tokens in a map that dies with the tab, because a
//! browser has nowhere trustworthy to put them. Desktop does have somewhere —
//! Keychain on macOS, the Credential Manager on Windows, the Secret Service on
//! Linux — and the `keyring` crate is the one abstraction over all three.
//!
//! A token never touches a project file or `settings.json` on either host.
//! That rule is why this module exists at all rather than Sefer writing a
//! dotfile.
//!
//! The driven build (the `webdriver` cargo feature, debug only, which `lib.rs`
//! refuses in a release) answers the same three commands from memory instead
//! (`driven`, below): its `HOME` is a scratch folder with no keychain, where a
//! sign-in failed with "A default keychain could not be found", and a script
//! must never write into the person's own. Driven runs therefore never
//! exercise the keychain path.

#[cfg(not(feature = "webdriver"))]
use keyring::Entry;

#[cfg(not(feature = "webdriver"))]
use crate::errors::{fail, IO};

#[cfg(not(feature = "webdriver"))]
fn entry(service: &str, account: &str) -> Result<Entry, String> {
    Entry::new(service, account).map_err(|error| fail(IO, error.to_string()))
}

/// `None` when the keychain holds nothing for this account — not an error, and
/// the distinction matters: the port's `get` returns `Option`, and a "no
/// credential yet" that arrived as a failure would make the sign-in flow look
/// broken on first use.
#[tauri::command]
pub fn credentials_get(service: String, account: String) -> Result<Option<String>, String> {
    #[cfg(feature = "webdriver")]
    return Ok(driven::get(service, account));
    #[cfg(not(feature = "webdriver"))]
    match entry(&service, &account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(fail(IO, error.to_string())),
    }
}

#[tauri::command]
pub fn credentials_set(service: String, account: String, secret: String) -> Result<(), String> {
    #[cfg(feature = "webdriver")]
    return {
        driven::set(service, account, secret);
        Ok(())
    };
    #[cfg(not(feature = "webdriver"))]
    entry(&service, &account)?
        .set_password(&secret)
        .map_err(|error| fail(IO, error.to_string()))
}

/// Idempotent: clearing an account the keychain does not know succeeds, so a
/// sign-out is always safe to run twice.
#[tauri::command]
pub fn credentials_clear(service: String, account: String) -> Result<(), String> {
    #[cfg(feature = "webdriver")]
    return {
        driven::clear(service, account);
        Ok(())
    };
    #[cfg(not(feature = "webdriver"))]
    match entry(&service, &account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(fail(IO, error.to_string())),
    }
}

/// The driven build's credential store: a map that lives as long as the
/// process, so a script signs in once per run and nothing reaches a keychain
/// or a file.
#[cfg(feature = "webdriver")]
mod driven {
    use std::collections::HashMap;
    use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};

    type Store = HashMap<(String, String), String>;

    fn held() -> MutexGuard<'static, Store> {
        static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
        STORE
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub fn get(service: String, account: String) -> Option<String> {
        held().get(&(service, account)).cloned()
    }

    pub fn set(service: String, account: String, secret: String) {
        held().insert((service, account), secret);
    }

    pub fn clear(service: String, account: String) {
        held().remove(&(service, account));
    }
}
