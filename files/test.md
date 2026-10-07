Start with these checks in order. The biggest question is whether the Dell permits native libraries (.node / .dll) inside existing Node or VS Code processes.

| Check | What to test or record | Why it matters |
|---|---|---|
| 1. Exact execution restriction | Existing blocked-app error: security product, rule, and whether it mentions unsigned code, publisher, location, or file type | Determines whether the restriction extends beyond .exe |
| 2. Hardware and memory | CPU model, physical/logical cores, total and currently available RAM, free disk space | Establishes the practical model budget |
| 3. GPU and driver | Exact Intel adapter and driver version; Task Manager → Performance → GPU: dedicated/shared memory | Determines potential acceleration and memory headroom |
| 4. Existing Node | Version, architecture, worker threads, WebAssembly/shared memory, loopback connectivity | Checks whether an existing local host can support inference |
| 5. Existing Python | Version, architecture, installed inference packages, actual ONNX Runtime providers | Identifies another usable runtime without installation |
| 6. VS Code runtime | Help → About; Developer: Show Running Extensions; whether extensions run locally or remotely | Confirms that execution would happen on the Dell |
| 7. Extension restrictions | Whether custom extensions/VSIX packages are permitted; workspace Restricted Mode; extension policies | Determines whether a custom inference extension is deployable |
| 8. Native-library loading | Whether a reviewed inference .node/.dll is permitted to load | Decides whether native CPU/Vulkan inference is viable |
| 9. GPU runtimes | Existing Vulkan, DirectML, OpenCL, OpenVINO/Level Zero support | Identifies candidate backends; library presence alone isn't proof |
| 10. Browser capabilities | WebGPU adapter/device creation, shader-f16, buffer limits, WebAssembly memory64/shared memory | Establishes the browser fallback |
| 11. Model access | Can the approved model file be transferred, stored and read locally? Any size restrictions? | Every local route needs accessible weights |
| 12. Actual performance | Once a runtime works: model load time, first-token latency, tokens/sec, peak RAM/GPU memory | Lets us choose based on measurements |

For check 1, inspect the existing block notification. Windows App Control blocks may also appear in Event Viewer → Applications and Services Logs → Microsoft → Windows → CodeIntegrity → Operational; event 3077 indicates an enforcement block. Missing events don't rule out another endpoint product. Microsoft troubleshooting guide

I prepared four source-only probes. They create no .exe, install nothing, and download nothing.

Put the first three files in an approved folder on the Dell, open an ordinary PowerShell terminal there, and run:

```
.\Dell-Capability-Check.ps1
node .\dell-node-check.cjs
python -I -B .\dell-python-check.py
```

Files:
- Dell-Capability-Check.ps1 — hardware, PowerShell restrictions, commands and library presence.
- dell-node-check.cjs — existing Node, worker thread, WASM/shared memory, and a temporary socket bound only to 127.0.0.1.
- dell-python-check.py — installed packages; imports existing NumPy/ONNX Runtime and reports available providers.
- dell-browser-check.js — copy into browser DevTools on a trusted HTTPS page. Reports WebGPU and WASM capabilities.

If a command is blocked or unavailable, record that result and continue with the others. Keep existing security settings.

These probes deliberately leave native-addon permission unresolved. Successfully importing an already installed package doesn't prove a new inference library will be permitted. Likewise, VS Code offering "Install from VSIX" doesn't establish permission to install a custom extension. VS Code extension documentation

Send back the JSON outputs, VS Code version, GPU memory figures, and the block's wording, with company identifiers redacted. That should let us choose among native Node/VS Code inference, an existing Python backend, or browser/WASM inference.

The Node and Python probes passed locally on this Mac; the PowerShell and browser checks still need execution on the Dell.
