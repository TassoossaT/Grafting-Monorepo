//! Capability negotiation (master source S12.3), scoped down from the
//! section's full field list (build ID, target, async-support signaling)
//! -- no build pipeline produces a build ID yet and no cross-target
//! matrix exists. This is a deliberately smaller v1, documented as such,
//! not silently implied complete.

use crate::status::EngineStatus;

pub const ABI_MAJOR: u32 = 1;
pub const ABI_MINOR: u32 = 0;

pub const FEATURE_CPU_BACKEND: u32 = 1 << 0;
pub const FEATURE_GPU_BACKEND: u32 = 1 << 1;

/// Every public struct begins with `struct_size` (S12.2) so callers can
/// tell an `ABI_MINOR` field-appending change apart from a real mismatch.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct EngineAbiInfo {
    pub struct_size: u32,
    pub abi_major: u32,
    pub abi_minor: u32,
    /// Bitmask of `FEATURE_*` constants. Both bits are meaningful today:
    /// CPU is always set (`compute-cpu` exists); GPU is always clear (no
    /// `compute-wgpu` yet).
    pub feature_flags: u32,
    /// No wire protocol exists yet (that needs C-005/C-006); fixed at 0.
    pub protocol_version: u32,
}

impl EngineAbiInfo {
    pub(crate) fn current() -> Self {
        EngineAbiInfo {
            struct_size: std::mem::size_of::<EngineAbiInfo>() as u32,
            abi_major: ABI_MAJOR,
            abi_minor: ABI_MINOR,
            feature_flags: FEATURE_CPU_BACKEND,
            protocol_version: 0,
        }
    }
}

/// Reports this build's ABI so the host can decide compatibility before
/// calling anything else (S12.3: "the C# wrapper validates this at
/// startup").
///
/// # Safety
/// `out_info` must be a valid, writable `EngineAbiInfo*`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_get_abi_info(out_info: *mut EngineAbiInfo) -> EngineStatus {
    if out_info.is_null() {
        return EngineStatus::NullPointer;
    }
    unsafe {
        *out_info = EngineAbiInfo::current();
    }
    EngineStatus::Ok
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_current_abi() {
        let info = EngineAbiInfo::current();
        assert_eq!(info.abi_major, ABI_MAJOR);
        assert_eq!(info.abi_minor, ABI_MINOR);
        assert_eq!(info.struct_size as usize, std::mem::size_of::<EngineAbiInfo>());
        assert_eq!(info.feature_flags & FEATURE_CPU_BACKEND, FEATURE_CPU_BACKEND);
        assert_eq!(info.feature_flags & FEATURE_GPU_BACKEND, 0);
    }

    #[test]
    fn null_out_pointer_is_rejected() {
        let status = unsafe { engine_get_abi_info(std::ptr::null_mut()) };
        assert_eq!(status, EngineStatus::NullPointer);
    }

    #[test]
    fn writes_through_a_valid_pointer() {
        let mut info = std::mem::MaybeUninit::<EngineAbiInfo>::uninit();
        let status = unsafe { engine_get_abi_info(info.as_mut_ptr()) };
        assert_eq!(status, EngineStatus::Ok);
        let info = unsafe { info.assume_init() };
        assert_eq!(info.abi_major, ABI_MAJOR);
    }
}
