// Extend Error interface for Express body-parser errors
interface Error {
  type?: string;
  status?: number;
}

// Extend Express Request to include authenticated user
declare namespace Express {
  interface Request {
    user?: {
      id: number;
      username: string;
    };
  }
}
