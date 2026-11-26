//! B22: the desktop app only touches files the person actually chose.
//!
//! * A project file can be saved only if it was opened, or picked in a Save dialog, in this session.
//! * An image can be read as "dropped" only if it arrived in a real drop onto the window.
//!
//! Before this, `save_project` wrote to any `.pflow` path it was handed and `read_dropped_image` read
//! any image file on the disk, so one injection bug in the page could have reached the file system.
//! This module has no Tauri dependency so it can be tested on its own.

use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_REMEMBERED_PATHS: usize = 256;

pub const PROJECT_NOT_CHOSEN: &str = "ProtoFlow can only save to a project file you opened or chose with Save As in this session. Use Save As to pick the file again.";
pub const IMAGE_NOT_DROPPED: &str = "ProtoFlow can only read images you dropped onto the window.";

#[derive(Default)]
pub struct ApprovedPaths {
    projects: Mutex<VecDeque<String>>,
    dropped: Mutex<VecDeque<String>>,
}

/// A comparable form of a path. Duplicate separators and `.` segments are ignored, `..` is kept as it is
/// (so a path that climbs out of a folder never equals the folder's real path), and Windows paths ignore case.
fn path_key(path: &Path) -> String {
    let joined = path
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/");
    if cfg!(windows) {
        joined.to_lowercase()
    } else {
        joined
    }
}

fn remember(list: &Mutex<VecDeque<String>>, key: String) {
    let mut entries = list.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if entries.iter().any(|existing| *existing == key) {
        return;
    }
    if entries.len() >= MAX_REMEMBERED_PATHS {
        entries.pop_front();
    }
    entries.push_back(key);
}

fn knows(list: &Mutex<VecDeque<String>>, key: &str) -> bool {
    list.lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .any(|existing| existing == key)
}

impl ApprovedPaths {
    /// Remember a project file the person opened or picked in a dialog.
    pub fn approve_project(&self, path: &Path) {
        remember(&self.projects, path_key(path));
    }

    pub fn is_project_approved(&self, path: &Path) -> bool {
        knows(&self.projects, &path_key(path))
    }

    /// Remember the files of a real drop event.
    pub fn record_drop(&self, paths: &[PathBuf]) {
        for path in paths {
            remember(&self.dropped, path_key(path));
        }
    }

    pub fn is_drop_approved(&self, path: &Path) -> bool {
        knows(&self.dropped, &path_key(path))
    }
}

/// `None` means "ask with a Save dialog", which is always allowed. A given path must have been chosen before.
pub fn check_save_target(approved: &ApprovedPaths, path: Option<&Path>) -> Result<(), String> {
    match path {
        None => Ok(()),
        Some(path) if approved.is_project_approved(path) => Ok(()),
        Some(_) => Err(PROJECT_NOT_CHOSEN.into()),
    }
}

pub fn check_dropped_image(approved: &ApprovedPaths, path: &Path) -> Result<(), String> {
    if approved.is_drop_approved(path) {
        Ok(())
    } else {
        Err(IMAGE_NOT_DROPPED.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(text: &str) -> PathBuf {
        PathBuf::from(text)
    }

    #[test]
    fn a_dialog_save_is_always_allowed() {
        let approved = ApprovedPaths::default();
        assert!(check_save_target(&approved, None).is_ok());
    }

    #[test]
    fn saving_to_a_path_nobody_chose_is_refused() {
        let approved = ApprovedPaths::default();
        let error = check_save_target(&approved, Some(&p("/home/me/.bashrc.pflow"))).unwrap_err();
        assert_eq!(error, PROJECT_NOT_CHOSEN);
    }

    #[test]
    fn saving_to_an_opened_or_picked_project_is_allowed() {
        let approved = ApprovedPaths::default();
        approved.approve_project(&p("/home/me/work/app.pflow"));
        assert!(check_save_target(&approved, Some(&p("/home/me/work/app.pflow"))).is_ok());
        assert!(check_save_target(&approved, Some(&p("/home/me/work/other.pflow"))).is_err());
    }

    #[test]
    fn duplicate_separators_and_dot_segments_do_not_matter() {
        let approved = ApprovedPaths::default();
        approved.approve_project(&p("/home/me/work/app.pflow"));
        assert!(approved.is_project_approved(&p("/home//me/./work/app.pflow")));
    }

    #[test]
    fn a_path_that_climbs_out_of_a_folder_is_not_the_approved_path() {
        let approved = ApprovedPaths::default();
        approved.approve_project(&p("/home/me/work/app.pflow"));
        assert!(!approved.is_project_approved(&p("/home/me/work/../.ssh/evil.pflow")));
        assert!(!approved.is_project_approved(&p("/home/me/work/sub/../app.pflow")));
    }

    #[test]
    fn case_matters_only_on_systems_where_it_matters() {
        let approved = ApprovedPaths::default();
        approved.approve_project(&p("/home/me/Work/App.pflow"));
        assert_eq!(
            approved.is_project_approved(&p("/home/me/work/app.pflow")),
            cfg!(windows)
        );
    }

    #[test]
    fn only_dropped_images_can_be_read_as_dropped() {
        let approved = ApprovedPaths::default();
        assert_eq!(
            check_dropped_image(&approved, &p("/home/me/secret.png")).unwrap_err(),
            IMAGE_NOT_DROPPED
        );
        approved.record_drop(&[p("/home/me/pics/a.png"), p("/home/me/pics/b.png")]);
        assert!(check_dropped_image(&approved, &p("/home/me/pics/a.png")).is_ok());
        assert!(check_dropped_image(&approved, &p("/home/me/pics/b.png")).is_ok());
        assert!(check_dropped_image(&approved, &p("/home/me/pics/c.png")).is_err());
    }

    #[test]
    fn project_and_drop_approvals_do_not_mix() {
        let approved = ApprovedPaths::default();
        approved.approve_project(&p("/home/me/app.pflow"));
        approved.record_drop(&[p("/home/me/pic.png")]);
        assert!(check_dropped_image(&approved, &p("/home/me/app.pflow")).is_err());
        assert!(check_save_target(&approved, Some(&p("/home/me/pic.png"))).is_err());
    }

    #[test]
    fn the_oldest_paths_are_forgotten_after_the_limit() {
        let approved = ApprovedPaths::default();
        for index in 0..(MAX_REMEMBERED_PATHS + 5) {
            approved.approve_project(&p(&format!("/p/{index}.pflow")));
        }
        assert!(!approved.is_project_approved(&p("/p/0.pflow")));
        assert!(
            approved.is_project_approved(&p(&format!("/p/{}.pflow", MAX_REMEMBERED_PATHS + 4)))
        );
    }

    #[test]
    fn approving_the_same_path_twice_does_not_use_up_space() {
        let approved = ApprovedPaths::default();
        for _ in 0..(MAX_REMEMBERED_PATHS * 2) {
            approved.approve_project(&p("/p/same.pflow"));
        }
        approved.approve_project(&p("/p/other.pflow"));
        assert!(approved.is_project_approved(&p("/p/same.pflow")));
    }
}
