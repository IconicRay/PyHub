const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

app.post('/api/run', (req, res) => {
    // Expecting code files, active file, and an array of user inputs
    const { files, activeFile, inputs = [] } = req.body;

    if (!files || !activeFile) {
        return res.status(400).json({ error: "Missing workspace files." });
    }

    const sessionID = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const sessionPath = path.join(__dirname, 'tmp', sessionID);
    
    try {
        fs.mkdirSync(sessionPath, { recursive: true });

        for (const [filename, content] of Object.entries(files)) {
            const safePath = path.join(sessionPath, filename);
            if (safePath.startsWith(sessionPath)) {
                fs.writeFileSync(safePath, content);
            }
        }

        // --- THE INPUT OVERRIDE INJECTOR ---
        // We write a wrapper that intercepts builtins.input and serves pre-defined responses
        const inputOverrideCode = `
import builtins
_frontend_inputs = ${JSON.stringify(inputs)}
_input_counter = 0

def _custom_input(prompt=""):
    global _input_counter
    if prompt: print(prompt, end="")
    if _input_counter < len(_frontend_inputs):
        val = _frontend_inputs[_input_counter]
        _input_counter += 1
        print(val) # Echo back to terminal
        return val
    else:
        print("\\n[pyHub Warning: Script requested input() but no more inputs were provided.]")
        return ""

builtins.input = _custom_input
`;
        
        // Prepend our override trick into the active file execution matrix
        const originalCode = fs.readFileSync(path.join(sessionPath, activeFile), 'utf8');
        fs.writeFileSync(path.join(sessionPath, activeFile), inputOverrideCode + "\n" + originalCode);
        // ------------------------------------

        const pythonProcess = spawn('python3', [activeFile], { cwd: sessionPath });

        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Transfer-Encoding', 'chunked');

        pythonProcess.stdout.on('data', (data) => {
            res.write(JSON.stringify({ type: 'stdout', text: data.toString() }) + '\n');
        });

        pythonProcess.stderr.on('data', (data) => {
            res.write(JSON.stringify({ type: 'stderr', text: data.toString() }) + '\n');
        });

        pythonProcess.on('close', (code) => {
            res.write(JSON.stringify({ type: 'exit', code }) + '\n');
            res.end();
            try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (e) {}
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`[*] pyHub Engine running smoothly on port ${PORT}`);
});
