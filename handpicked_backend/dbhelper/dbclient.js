import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from "path";

dotenv.config({
     path: path.resolve(process.cwd(), ".env"),
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export { supabase }; 