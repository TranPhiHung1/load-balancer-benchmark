const express = require("express");

const app = express();

const PORT = 3002;

app.get('/api', (req, res) => {
    res.json({
        message: 'Hello from Backend 2',
        port: 3002
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend 2 is running on port ${PORT}`);
});