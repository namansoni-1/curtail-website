import os
import tempfile

# Point the app at a throwaway SQLite database before anything imports it.
_tmp = tempfile.mkdtemp(prefix="curtail-test-")
os.environ.setdefault("CURTAIL_DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ.setdefault("CURTAIL_DATA_DIR", _tmp)
