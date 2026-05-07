import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendPath = path.join(__dirname, '..', '..', 'Frontend-Empleo', 'src');

const mappings = [
    { regex: /['"`]http:\/\/localhost:3000([^'"`]*)['"`]/g, replacement: (match, p1) => '`${API_URLS.AUTH}' + p1 + '`' },
    { regex: /['"`]http:\/\/localhost:3001([^'"`]*)['"`]/g, replacement: (match, p1) => '`${API_URLS.PERFILES}' + p1 + '`' },
    { regex: /['"`]http:\/\/localhost:3002([^'"`]*)['"`]/g, replacement: (match, p1) => '`${API_URLS.PAGOS}' + p1 + '`' },
    { regex: /['"`]http:\/\/localhost:3003([^'"`]*)['"`]/g, replacement: (match, p1) => '`${API_URLS.TRABAJOS}' + p1 + '`' },
    { regex: /['"`]http:\/\/localhost:3005([^'"`]*)['"`]/g, replacement: (match, p1) => '`${API_URLS.NOTIFICACIONES}' + p1 + '`' },
];

function processDirectory(dir) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.lstatSync(fullPath).isDirectory()) {
            processDirectory(fullPath);
        } else if (file.endsWith('.js') || file.endsWith('.vue')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let replaced = false;

            mappings.forEach(m => {
                if (m.regex.test(content)) {
                    content = content.replace(m.regex, m.replacement);
                    replaced = true;
                }
            });

            if (content.includes('io(') && /['"`]http:\/\/localhost:3001['"`]/.test(content)) {
                 content = content.replace(/io\(['"`]http:\/\/localhost:3001['"`]/g, 'io(SOCKET_URL');
                 replaced = true;
            }

            if (replaced) {
                // Check if import is actually missing (not just the string API_URLS)
                if (!content.includes('import { API_URLS')) {
                    const relativePath = path.relative(path.dirname(fullPath), path.join(frontendPath, 'config.js')).replace(/\\/g, '/');
                    let importPath = relativePath.startsWith('.') ? relativePath : './' + relativePath;
                    if (!importPath.endsWith('.js')) importPath += '.js';
                    
                    const finalImport = `import { API_URLS, SOCKET_URL } from '${importPath}';\n`;
                    
                    if (file.endsWith('.vue')) {
                        content = content.replace(/(<script[^>]*>)/, (match) => match + '\n' + finalImport);
                    } else {
                        content = finalImport + content;
                    }
                }

                fs.writeFileSync(fullPath, content);
                console.log(`Updated: ${fullPath}`);
            }
        }
    });
}

processDirectory(frontendPath);
