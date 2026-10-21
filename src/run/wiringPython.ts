/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a Python check executed, recorded with no package installed.
 *
 * Node reports what it executed when `NODE_V8_COVERAGE` names a directory;
 * Python has no such variable. Python imports `sitecustomize` at start-up
 * from the first directory on its path that holds one, so a directory put
 * first on PYTHONPATH with a `sitecustomize.py` in it records every Python
 * process the check starts. The recorder notes each file whose code began
 * to run — `sys.monitoring` on Python 3.12 and later, `sys.settrace` before
 * it — and at exit writes them to the recording directory in the shape
 * Node's coverage files have, so both are read by one reader.
 *
 * The `sitecustomize` it shadows, if the interpreter has one, runs too: a
 * check must run under the recorder exactly as it ran without it.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** The variable naming the directory the recorder writes to. */
const PYTHON_TRACE_ENV = "TANDEM_PYTHON_TRACE_DIR";

/** The recorder, as Python source. */
const SITECUSTOMIZE = `
import atexit
import json
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
_out = os.environ.get("${PYTHON_TRACE_ENV}")
_seen = set()


def _record_start(code, _offset):
    _seen.add(code.co_filename)
    return sys.monitoring.DISABLE


def _record_call(frame, event, _arg):
    if event == "call":
        _seen.add(frame.f_code.co_filename)
    return None


def _write():
    files = sorted(f for f in _seen if os.path.isabs(f) and os.path.isfile(f))
    result = [{"url": "file://" + f, "functions": [{"ranges": [{"count": 1}]}]} for f in files]
    with open(os.path.join(_out, "python-%d.json" % os.getpid()), "w") as fh:
        json.dump({"result": result}, fh)


if _out:
    if hasattr(sys, "monitoring"):
        _tool = next((t for t in range(6) if sys.monitoring.get_tool(t) is None), None)
        if _tool is not None:
            sys.monitoring.use_tool_id(_tool, "tandem-wiring")
            sys.monitoring.register_callback(_tool, sys.monitoring.events.PY_START, _record_start)
            sys.monitoring.set_events(_tool, sys.monitoring.events.PY_START)
            atexit.register(_write)
    else:
        import threading

        sys.settrace(_record_call)
        threading.settrace(_record_call)
        atexit.register(_write)

for _entry in sys.path:
    _dir = os.path.abspath(_entry or ".")
    _shadowed = os.path.join(_dir, "sitecustomize.py")
    if _dir != _here and os.path.isfile(_shadowed):
        import importlib.util

        _spec = importlib.util.spec_from_file_location("_tandem_shadowed_sitecustomize", _shadowed)
        _module = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(_module)
        break
`;

/**
 * Write the recorder into `dir` and return what a command is prefixed
 * with to run under it, recording into `traceDir`.
 */
export async function pythonRecorder(dir: string, traceDir: string): Promise<string> {
  await fs.writeFile(path.join(dir, "sitecustomize.py"), SITECUSTOMIZE);
  return `${PYTHON_TRACE_ENV}='${traceDir}' PYTHONPATH='${dir}'\${PYTHONPATH:+:$PYTHONPATH}`;
}
