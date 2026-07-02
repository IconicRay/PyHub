const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;

// Allow Netlify frontend to talk to this Render backend
app.use(cors());
app.use(express.json());

app.post('/api/run', (req, res) => {
    const { files, activeFile } = req.body;

    if (!files || !activeFile) {
        return res.status(400).json({ error: "Missing workspace files." });
    }

    // 1. Create an isolated, unique temporary workspace for this run
    const sessionID = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const sessionPath = path.join(__dirname, 'tmp', sessionID);
    
    try {
        fs.mkdirSync(sessionPath, { recursive: true });

        // 2. Hydrate the server's disk with the frontend's virtual files
        for (const [filename, content] of Object.entries(files)) {
            const safePath = path.join(sessionPath, filename);
            if (safePath.startsWith(sessionPath)) {
                fs.writeFileSync(safePath, content);
            }
        }

        // 3. Spawn the native Python process
        const pythonProcess = spawn('python3', [activeFile], { cwd: sessionPath });

        // 4. Set up chunked streaming response
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Transfer-Encoding', 'chunked');

        pythonProcess.stdout.on('data', (data) => {
            res.write(JSON.stringify({ type: 'stdout', text: data.toString() }) + '\n');
        });

        pythonProcess.stderr.on('data', (data) => {
            res.write(JSON.stringify({ type: 'stderr', text: data.toString() }) + '\n');
        });

        // 5. Cleanup on finish
        pythonProcess.on('close', (code) => {
            res.write(JSON.stringify({ type: 'exit', code }) + '\n');
            res.end();
            try {
                fs.rmSync(sessionPath, { recursive: true, force: true });
            } catch (err) { console.error("Cleanup error:", err); }
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`[*] SourcePad Live Cloud Engine humming on port ${PORT}`);
});