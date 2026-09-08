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

use keyring::Entry;

use crate::errors::{fail, IO};

fn entry(service: &str, account: &str) -> Result<Entry, String> {
    Entry::new(service, account).map_err(|error| fail(IO, error.to_string()))
}

/// `None` when the keychain holds nothing for this account — not an error, and
/// the distinction matters: the port's `get` returns `Option`, and a "no
/// credential yet" that arrived as a failure would make the sign-in flow look
/// broken on first use.
#[tauri::command]
pub fn credentials_get(service: String, account: String) -> Result<Option<String>, String> {
    match entry(&service, &account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(fail(IO, error.to_string())),
    }
}

#[tauri::command]
pub fn credentials_set(service: String, account: String, secret: String) -> Result<(), String> {
    entry(&service, &account)?
        .set_password(&secret)
        .map_err(|error| fail(IO, error.to_string()))
}

/// Idempotent: clearing an account the keychain does not know succeeds, so a
/// sign-out is always safe to run twice.
#[tauri::command]
pub fn credentials_clear(service: String, account: String) -> Result<(), String> {
    match entry(&service, &account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(fail(IO, error.to_string())),
    }
}
