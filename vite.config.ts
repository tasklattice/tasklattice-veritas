import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({plugins:[react(),tailwindcss()],resolve:{alias:{'@':fileURLToPath(new URL('./web',import.meta.url))}},root:'web',build:{outDir:'../dist/web',emptyOutDir:true},server:{host:'127.0.0.1'}});
