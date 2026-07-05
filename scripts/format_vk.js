const fs = require('fs');

const vk = JSON.parse(fs.readFileSync('circuits/verification_key.json'));

console.log("Not implementing rust hardcoding, we will just parse it in JS.");
