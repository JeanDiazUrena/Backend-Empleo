import fs from 'fs';

const filePath = 'c:/Users/wilso/OneDrive/Documentos/PROYECTO-EMPLEO SERVIHUB/BACKEND/trabajo-service/src/server.js';
let content = fs.readFileSync(filePath, 'utf8');

// Helper to replace notification bodies
function updateNotif(title, metadataUrl) {
    const regex = new RegExp(`title:\\s*'${title}',\\s*message:\\s*([\`'].*?[\`']),\\s*type:\\s*'(.*?)'\\s*}\\)`, 'g');
    content = content.replace(regex, (match, message, type) => {
        return `title: '${title}',\n                    message: ${message},\n                    type: '${type}',\n                    metadata: { url: '${metadataUrl}' }\n                })`;
    });
}

updateNotif('Solicitud Aceptada', '/client/dashboard');
updateNotif('Nuevo Trabajo', '/professional/dashboard');
updateNotif('Pago Liberado', '/professional/dashboard');
updateNotif('Comprobante Subido', '/professional/dashboard');
updateNotif('Cotización Recibida', '/client/dashboard');
updateNotif('Nueva Cotización Recibida', '/client/dashboard');
updateNotif('Cotización Aceptada', '/professional/dashboard');
updateNotif('Trabajo Terminado', '/client/dashboard');
updateNotif('Comprobante de Pago Recibido', '/professional/dashboard');

// Special case for Pago Confirmado (needs workId)
content = content.replace(/title: 'Pago Confirmado',\s*message: ([\`'].*?[\`']),\s*type: 'success'\s*}\)/g, (match, message) => {
    return `title: 'Pago Confirmado',\n                    message: ${message},\n                    type: 'success',\n                    metadata: { url: \`/client/receipt/\${trabajo_id}\` }\n                })`;
});

fs.writeFileSync(filePath, content);
console.log("File updated successfully!");
