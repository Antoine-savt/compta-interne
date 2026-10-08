import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 3000,
        // En local, les Netlify Functions sont servies par `netlify dev` (port 8888)
        proxy: {
            '/api': {
                target: 'http://localhost:8888',
                rewrite: (path) => path.replace(/^\/api/, '/.netlify/functions'),
            },
        },
    },
});
