import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { initializeDatabase } from './db/init';

const PORT = process.env.PORT || 3000;

initializeDatabase();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
