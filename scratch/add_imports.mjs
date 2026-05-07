import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendPath = path.join(__dirname, '..', '..', 'Frontend-Empleo', 'src');

function processDirectory(dir) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.lstatSync(fullPath).isDirectory()) {
            processDirectory(fullPath);
        } else if (file.endsWith('.js') || file.endsWith('.vue')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            
            if ((content.includes('API_URLS') || content.includes('SOCKET_URL')) && !content.includes('import { API_URLS')) {
                const relativePath = path.relative(path.dirname(fullPath), path.join(frontendPath, 'config.js')).replace(/\\/g, '/');
                let importPath = relativePath.startsWith('.') ? relativePath : './' + relativePath;
                if (!importPath.endsWith('.js')) importPath += '.js';
                
                const finalImport = `import { API_URLS, SOCKET_URL } from '${importPath}';\n`;
                
                if (file.endsWith('.vue')) {
                    content = content.replace(/(<script[^>]*>)/, (match) => match + '\n' + finalImport);
                } else {
                    content = finalImport + content;
                }

                fs.writeFileSync(fullPath, content);
                console.log(`Added import to: ${fullPath}`);
            }
        }
    });
}

processDirectory(frontendPath);
