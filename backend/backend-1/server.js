const express = require("express");

const app = express();

const PORT = 3001;

app.get('/api', (req, res) => {
    res.json({
        message: 'Hello from Backend 1',
        port: 3001
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend 1 is running on port ${PORT}`);
});