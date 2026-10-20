use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use keyring::Entry;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use super::file_io::get_device_id;

const KEYRING_SERVICE: &str = "app.protoflow.desktop";
const KEYRING_ACCOUNT: &str = "anonymous-wallet-jwt";
const INSTALL_ID_FILE: &str = "wallet-install-id";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletIdentity {
    device_id: String,
    install_id: String,
}

fn load_or_create_install_id(directory: &Path) -> Result<String, String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create wallet identity storage: {error}"))?;
    let path = directory.join(INSTALL_ID_FILE);

    match fs::read_to_string(&path) {
        Ok(value) => {
            let parsed = Uuid::parse_str(value.trim())
                .map_err(|error| format!("The saved install ID is invalid: {error}"))?;
            Ok(parsed.to_string())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let install_id = Uuid::new_v4().to_string();
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|error| format!("Could not create the install ID: {error}"))?;
            file.write_all(install_id.as_bytes())
                .and_then(|()| file.sync_all())
                .map_err(|error| format!("Could not save the install ID: {error}"))?;
            Ok(install_id)
        }
        Err(error) => Err(format!("Could not read the saved install ID: {error}")),
    }
}

fn device_id_for_install(device_id: &str, install_id: &str) -> String {
    let digest = Sha256::digest(format!("{device_id}:{install_id}").as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn replace_install_id(directory: &Path) -> Result<String, String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create wallet identity storage: {error}"))?;
    let install_id = Uuid::new_v4().to_string();
    let path = directory.join(INSTALL_ID_FILE);
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
        .map_err(|error| format!("Could not reset the install ID: {error}"))?;
    file.write_all(install_id.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("Could not save the reset install ID: {error}"))?;
    Ok(install_id)
}

fn wallet_jwt_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| format!("Could not access secure wallet storage: {error}"))
}

#[tauri::command]
pub fn get_wallet_identity(app: AppHandle) -> Result<WalletIdentity, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate wallet identity storage: {error}"))?;
    let install_id = load_or_create_install_id(&app_data_dir)?;
    Ok(WalletIdentity {
        device_id: device_id_for_install(&get_device_id()?, &install_id),
        install_id,
    })
}

#[tauri::command]
pub fn reset_wallet_identity(app: AppHandle) -> Result<WalletIdentity, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate wallet identity storage: {error}"))?;
    clear_wallet_jwt()?;
    let hardware_device_id = get_device_id()?;
    let install_id = replace_install_id(&app_data_dir)?;
    Ok(WalletIdentity {
        device_id: device_id_for_install(&hardware_device_id, &install_id),
        install_id,
    })
}

#[tauri::command]
pub fn get_wallet_jwt() -> Result<Option<String>, String> {
    match wallet_jwt_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read the secure wallet token: {error}")),
    }
}

#[tauri::command]
pub fn save_wallet_jwt(token: String) -> Result<(), String> {
    if token.is_empty() || token.len() > 8192 || token.split('.').count() != 3 {
        return Err("The wallet service returned an invalid token.".into());
    }
    wallet_jwt_entry()?
        .set_password(&token)
        .map_err(|error| format!("Could not save the secure wallet token: {error}"))
}

#[tauri::command]
pub fn clear_wallet_jwt() -> Result<(), String> {
    match wallet_jwt_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not clear the secure wallet token: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn install_id_is_stable_between_reads() {
        let directory = tempdir().unwrap();
        let first = load_or_create_install_id(directory.path()).unwrap();
        let second = load_or_create_install_id(directory.path()).unwrap();

        assert_eq!(first, second);
        assert!(Uuid::parse_str(&first).is_ok());
    }

    #[test]
    fn reset_replaces_the_persisted_install_id() {
        let directory = tempdir().unwrap();
        let first = load_or_create_install_id(directory.path()).unwrap();
        let reset = replace_install_id(directory.path()).unwrap();

        assert_ne!(first, reset);
        assert_eq!(load_or_create_install_id(directory.path()).unwrap(), reset);
    }

    #[test]
    fn invalid_saved_install_id_is_reported() {
        let directory = tempdir().unwrap();
        fs::write(directory.path().join(INSTALL_ID_FILE), "not-a-uuid").unwrap();

        assert!(load_or_create_install_id(directory.path()).is_err());
    }

    #[test]
    fn device_identity_is_stable_per_install_and_changes_after_reset() {
        let first = device_id_for_install("hardware-hash", "install-one");
        let same_install = device_id_for_install("hardware-hash", "install-one");
        let reset_install = device_id_for_install("hardware-hash", "install-two");

        assert_eq!(first, same_install);
        assert_ne!(first, reset_install);
        assert_eq!(first.len(), 64);
    }

    #[test]
    fn changed_device_fingerprint_changes_hashed_identity() {
        assert_ne!(
            device_id_for_install("hardware-before", "same-install"),
            device_id_for_install("hardware-after", "same-install")
        );
    }
}
