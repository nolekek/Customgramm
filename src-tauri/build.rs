use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();

    // Copy runtime DLLs from bin/ to target output directory
    let target_dir = env::var("OUT_DIR").map(|p| {
        let mut path = PathBuf::from(p);
        // OUT_DIR is target/debug/build/.../out, we want target/debug/
        while let Some(parent) = path.parent() {
            if path.file_name().and_then(|f| f.to_str()) == Some("build") {
                return parent.to_path_buf();
            }
            path = parent.to_path_buf();
        }
        path
    });

    if let Ok(dest_dir) = target_dir {
        let candidate_bin_dirs = [
            Path::new("bin"),
            Path::new("../bin"),
            Path::new("../../bin"),
        ];

        for bin_dir in &candidate_bin_dirs {
            if bin_dir.is_dir() {
                if let Ok(entries) = fs::read_dir(bin_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                            if ext.eq_ignore_ascii_case("dll") || ext.eq_ignore_ascii_case("so") || ext.eq_ignore_ascii_case("dylib") {
                                if let Some(file_name) = path.file_name() {
                                    let dest = dest_dir.join(file_name);
                                    let _ = fs::copy(&path, &dest);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
