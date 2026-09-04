"""Tests for J-Link DLL discovery (_find_newest_jlink_dll and helpers).

Regression cover for issue #42: on Linux the helper returned None, so pylink
fell back to its own search (os.walk of /opt/SEGGER, first hit wins) and could
load an outdated libjlinkarm.so on machines with several J-Link installs.
"""
import os
import sys

import pytest

from rtt_helper import _jlink_search_config, _pick_newest_dll, _find_newest_jlink_dll


def _make_install(root, dir_name, dll_name="libjlinkarm.so"):
    """Create <root>/<dir_name>/<dll_name> and return the DLL path."""
    d = root / dir_name
    d.mkdir()
    dll = d / dll_name
    dll.write_bytes(b"\x7fELF")
    return str(dll)


# ---------------------------------------------------------------- _pick_newest_dll

def test_picks_highest_numeric_version(tmp_path):
    _make_install(tmp_path, "JLink_V794")
    _make_install(tmp_path, "JLink_V810")
    newest = _make_install(tmp_path, "JLink_V924")
    assert _pick_newest_dll([str(tmp_path)], "libjlinkarm.so") == newest


def test_alpha_suffix_breaks_tie_within_same_version(tmp_path):
    _make_install(tmp_path, "JLink_V810")
    newest = _make_install(tmp_path, "JLink_V810a")
    assert _pick_newest_dll([str(tmp_path)], "libjlinkarm.so") == newest


def test_orders_linux_tarball_directory_names(tmp_path):
    """SEGGER's Linux tarballs unpack as JLink_Linux_V<ver>_<arch>."""
    _make_install(tmp_path, "JLink_Linux_V794e_x86_64")
    newest = _make_install(tmp_path, "JLink_Linux_V810b_x86_64")
    assert _pick_newest_dll([str(tmp_path)], "libjlinkarm.so") == newest


def test_skips_versioned_directory_that_has_no_dll(tmp_path):
    """A higher-versioned directory without the DLL must not win."""
    (tmp_path / "JLink_V999").mkdir()
    real = _make_install(tmp_path, "JLink_V810")
    assert _pick_newest_dll([str(tmp_path)], "libjlinkarm.so") == real


def test_resolves_a_symlinked_dll(tmp_path):
    """SEGGER ships libjlinkarm.so as a symlink rather than a regular file."""
    d = tmp_path / "JLink_V924a"
    d.mkdir()
    (d / "libjlinkarm.so.7.94.5").write_bytes(b"\x7fELF")
    link = d / "libjlinkarm.so"
    link.symlink_to("libjlinkarm.so.7.94.5")
    assert _pick_newest_dll([str(tmp_path)], "libjlinkarm.so") == str(link)


def test_searches_every_root_in_order(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    _make_install(a, "JLink_V794")
    newest = _make_install(b, "JLink_V924a")
    assert _pick_newest_dll([str(a), str(b)], "libjlinkarm.so") == newest


def test_returns_none_when_nothing_is_installed(tmp_path):
    assert _pick_newest_dll([str(tmp_path)], "libjlinkarm.so") is None


def test_returns_none_when_a_search_root_does_not_exist(tmp_path):
    missing = str(tmp_path / "nope")
    assert _pick_newest_dll([missing], "libjlinkarm.so") is None


# ------------------------------------------------------------- _jlink_search_config

def test_linux_searches_opt_segger_for_libjlinkarm_so(monkeypatch):
    """Issue #42: Linux previously returned no config at all, so pylink's own
    first-hit-wins search decided which DLL version was loaded."""
    monkeypatch.setattr(sys, "platform", "linux")
    search_dirs, dll_name = _jlink_search_config()
    assert "/opt/SEGGER" in search_dirs
    assert dll_name == "libjlinkarm.so"


def test_darwin_searches_applications_segger(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    search_dirs, dll_name = _jlink_search_config()
    assert search_dirs == ["/Applications/SEGGER"]
    assert dll_name == "libjlinkarm.dylib"


def test_windows_searches_both_program_files_roots(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    search_dirs, dll_name = _jlink_search_config()
    assert len(search_dirs) == 2
    assert all("SEGGER" in d for d in search_dirs)
    assert dll_name == "JLink_x64.dll"


# ------------------------------------------------------------ _find_newest_jlink_dll

def test_find_newest_returns_none_on_linux_when_opt_segger_is_absent(monkeypatch, tmp_path):
    """No /opt/SEGGER is not an error on Linux: the tarball can be unpacked
    anywhere. Returning None keeps the soft fallback to pylink's search."""
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(
        "rtt_helper._jlink_search_config",
        lambda: ([str(tmp_path / "absent")], "libjlinkarm.so"),
    )
    assert _find_newest_jlink_dll() is None


def test_find_newest_picks_the_newest_linux_install(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "linux")
    _make_install(tmp_path, "JLink_V794e")
    newest = _make_install(tmp_path, "JLink_V924a")
    monkeypatch.setattr(
        "rtt_helper._jlink_search_config",
        lambda: ([str(tmp_path)], "libjlinkarm.so"),
    )
    assert _find_newest_jlink_dll() == newest


# ------------------------------------- unversioned install directories (deb/rpm)

def _make_versioned_lib(root, dir_name, so_version, dll_name="libjlinkarm.so"):
    """Create an install whose library carries the version, the way SEGGER's
    Linux packages ship it: libjlinkarm.so -> .so.<major> -> .so.<major.minor.patch>."""
    d = root / dir_name
    d.mkdir()
    real = d / ("%s.%s" % (dll_name, so_version))
    real.write_bytes(b"\x7fELF")
    major = so_version.split(".")[0]
    mid = d / ("%s.%s" % (dll_name, major))
    mid.symlink_to(real.name)
    link = d / dll_name
    link.symlink_to(mid.name)
    return str(link)


def test_considers_an_unversioned_directory_via_its_library_version(tmp_path):
    """SEGGER's .deb/.rpm install in place at an unversioned /opt/SEGGER/JLink.
    The version is on the library file, so the directory name is not the only
    place to look for it."""
    newest = _make_versioned_lib(tmp_path, "JLink", "7.94.5")
    assert _pick_newest_dll([str(tmp_path)], "libjlinkarm.so") == newest


def test_newer_unversioned_install_beats_older_versioned_directory(tmp_path):
    """A package-managed install at /opt/SEGGER/JLink can be newer than a
    tarball left behind at /opt/SEGGER/JLink_V722b. Skipping the unversioned
    directory would deterministically select the older library."""
    _make_install(tmp_path, "JLink_V722b")
    newest = _make_versioned_lib(tmp_path, "JLink", "7.94.5")
    assert _pick_newest_dll([str(tmp_path)], "libjlinkarm.so") == newest


def test_newer_versioned_directory_still_beats_older_unversioned_install(tmp_path):
    _make_versioned_lib(tmp_path, "JLink", "7.22.2")
    newest = _make_install(tmp_path, "JLink_V924a")
    assert _pick_newest_dll([str(tmp_path)], "libjlinkarm.so") == newest


def test_skips_a_directory_with_no_version_in_either_place(tmp_path):
    """No version in the directory name and none on the library file: there is
    nothing to compare, so it is not a candidate."""
    _make_install(tmp_path, "JLink")
    versioned = _make_install(tmp_path, "JLink_V924a")
    assert _pick_newest_dll([str(tmp_path)], "libjlinkarm.so") == versioned


# ------------------------------------------------------------------ containment

def test_unreadable_search_root_returns_none_instead_of_raising(monkeypatch, tmp_path):
    """Discovery is called from _create_jlink() with no exception handling, and
    a helper that dies before printing its JSON reads to the extension as "no
    devices found" (the v0.5.7 regression class that rtt-helper-smoke covers).
    An unreadable /opt/SEGGER must degrade to pylink's own search, not crash."""
    def _boom(path):
        raise PermissionError(13, "Permission denied", path)

    monkeypatch.setattr(os, "listdir", _boom)
    assert _pick_newest_dll([str(tmp_path)], "libjlinkarm.so") is None


def test_unreadable_install_directory_does_not_hide_the_readable_ones(monkeypatch, tmp_path):
    """One bad entry must not take the whole scan down with it."""
    good = _make_install(tmp_path, "JLink_V924a")

    real_realpath = os.path.realpath

    def _selective(path):
        if "JLink_broken" in path:
            raise OSError(40, "Too many levels of symbolic links", path)
        return real_realpath(path)

    # Unversioned name, so the version has to come off the library file and
    # realpath is actually reached.
    _make_versioned_lib(tmp_path, "JLink_broken", "7.22.2")
    monkeypatch.setattr(os.path, "realpath", _selective)
    assert _pick_newest_dll([str(tmp_path)], "libjlinkarm.so") == good
