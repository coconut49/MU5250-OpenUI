//! The agent's own diagnostics log.
//!
//! The stock busybox `syslogd` runs with `-l 1` (emergency only) and has no
//! `logread` backend, so output piped to `logger` is discarded. Instead,
//! stdout/stderr are redirected into a pipe that a thread drains into a
//! size-capped file on `/data`, which survives reboots.
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::fd::FromRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use crate::csv_utils::{chrono_lite, now_secs};

pub const LOG_PATH: &str = "/data/local/tmp/zte-agent.log";
/// Per file; one rotated copy (`.1`) is kept, so at most twice this on flash.
const MAX_BYTES: u64 = 256 * 1024;

/// Redirect stdout/stderr into the log. On any failure output stays wherever
/// the startup script sent it.
pub fn init() {
    let Ok(log) = Log::open(PathBuf::from(LOG_PATH), MAX_BYTES) else {
        return;
    };
    let mut fds = [0; 2];
    // CLOEXEC on the pipe itself; dup2 onto 1/2 below yields plain fds, and
    // every subprocess the agent spawns sets its own stdout/stderr anyway.
    if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
        return;
    }
    let (read_fd, write_fd) = (fds[0], fds[1]);
    for fd in fds {
        unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) };
    }
    let redirected = unsafe { libc::dup2(write_fd, 1) >= 0 && libc::dup2(write_fd, 2) >= 0 };
    unsafe { libc::close(write_fd) };
    let reader = unsafe { File::from_raw_fd(read_fd) };
    if !redirected {
        return;
    }
    // The drain must never stop: a full pipe would block every eprintln!.
    std::thread::spawn(move || drain(BufReader::new(reader), log));
}

fn drain(reader: impl BufRead, mut log: Log) {
    // split, not lines(): invalid UTF-8 must not end the drain.
    for line in reader.split(b'\n') {
        let Ok(line) = line else { break };
        log.line(String::from_utf8_lossy(&line).trim_end());
    }
}

struct Log {
    path: PathBuf,
    file: File,
    written: u64,
    max: u64,
    previous: Option<String>,
    repeats: u64,
}

impl Log {
    fn open(path: PathBuf, max: u64) -> std::io::Result<Self> {
        let file = open_append(&path)?;
        let written = file.metadata()?.len();
        Ok(Self {
            path,
            file,
            written,
            max,
            previous: None,
            repeats: 0,
        })
    }

    /// Consecutive identical lines are counted, not written, so an error
    /// repeated by a periodic task cannot fill the file.
    fn line(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        if self.previous.as_deref() == Some(text) {
            self.repeats += 1;
            return;
        }
        if self.repeats > 0 {
            let note = format!("[log] previous message repeated {} times", self.repeats);
            self.write(&note);
            self.repeats = 0;
        }
        self.write(text);
        self.previous = Some(text.to_string());
    }

    fn write(&mut self, text: &str) {
        // The firmware keeps local time in the system clock (TZ is "UTC"), so
        // the stamp is device-local time, not UTC; drop chrono_lite's `Z`.
        let stamp = chrono_lite(now_secs());
        let stamp = stamp.trim_end_matches('Z');
        let entry = format!("{stamp} up={}s {text}\n", uptime_secs());
        if self.written + entry.len() as u64 > self.max {
            self.rotate();
        }
        // Errors (e.g. /data full) drop the line; the drain keeps running.
        if self.file.write_all(entry.as_bytes()).is_ok() {
            self.written += entry.len() as u64;
        }
    }

    fn rotate(&mut self) {
        let mut rotated = self.path.clone().into_os_string();
        rotated.push(".1");
        let _ = fs::rename(&self.path, rotated);
        if let Ok(file) = open_append(&self.path) {
            self.file = file;
            self.written = 0;
        }
    }
}

fn open_append(path: &Path) -> std::io::Result<File> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(path)
}

/// Seconds since boot. The wall clock can be wrong until NITZ sync, so each
/// line carries both.
fn uptime_secs() -> u64 {
    fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|s| s.split('.').next()?.parse().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_log(max: u64) -> (PathBuf, Log) {
        let dir =
            std::env::temp_dir().join(format!("zte-agent-log-test-{}-{}", std::process::id(), max));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("agent.log");
        let log = Log::open(path.clone(), max).unwrap();
        (path, log)
    }

    #[test]
    fn repeated_lines_are_collapsed_into_a_count() {
        let (path, mut log) = temp_log(64 * 1024);
        for _ in 0..5 {
            log.line("[charge_policy] charger control state is unavailable");
        }
        log.line("[server] listener down");
        let text = fs::read_to_string(&path).unwrap();
        assert_eq!(text.matches("charger control state").count(), 1);
        assert!(text.contains("previous message repeated 4 times"));
        assert!(text.ends_with("[server] listener down\n"));
    }

    #[test]
    fn rotation_bounds_the_file_and_keeps_one_previous_copy() {
        let (path, mut log) = temp_log(256);
        for i in 0..40 {
            log.line(&format!("line {i}"));
        }
        let current = fs::metadata(&path).unwrap().len();
        let mut rotated = path.clone().into_os_string();
        rotated.push(".1");
        assert!(current <= 256, "{current}");
        assert!(fs::metadata(&rotated).unwrap().len() <= 256);
        assert!(fs::read_to_string(&path).unwrap().contains("line 39"));
    }
}
