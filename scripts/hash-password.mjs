// Usage: npm run hash-password -- "my-strong-password"
import bcrypt from "bcryptjs";
const pw = process.argv[2];
if (!pw) { console.error('Usage: npm run hash-password -- "password"'); process.exit(1); }
const hash = bcrypt.hashSync(pw, 12);
console.log("\nADMIN_PASSWORD_HASH (base64, paste into .env):\n");
console.log(Buffer.from(hash).toString("base64"));
