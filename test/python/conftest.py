import importlib.util
import sys
from pathlib import Path

# Make fixtures importable as a top-level package
_TEST_DIR = Path(__file__).parent
sys.path.insert(0, str(_TEST_DIR))

# The helper file is `rtt-helper.py` (hyphen), which is not a legal Python
# module name for `import`. Load it manually via importlib and register it
# as `rtt_helper` in sys.modules so tests can `from rtt_helper import ...`.
_HELPER_PATH = _TEST_DIR.parent.parent / "src" / "transport" / "rtt-helper.py"
_spec = importlib.util.spec_from_file_location("rtt_helper", _HELPER_PATH)
_module = importlib.util.module_from_spec(_spec)
sys.modules["rtt_helper"] = _module
_spec.loader.exec_module(_module)
