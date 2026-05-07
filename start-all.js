const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const services = [
    { name: 'AUTH', dir: 'auth-service', port: 3000 },
    { name: 'PERFILES', dir: 'perfile-service', port: 3010 },
    { name: 'PAGOS', dir: 'pago-service', port: 3002 },
    { name: 'TRABAJOS', dir: 'trabajo-service', port: 3003 },
    { name: 'NOTIF', dir: 'notificacion-service', port: 3005 },
    { name: 'GATEWAY', dir: 'gateway', port: 4000 }
];

const getDevCommand = () => {
    if (process.platform === 'win32') {
        return {
            command: process.env.ComSpec || 'cmd.exe',
            args: ['/d', '/s', '/c', 'npm run dev']
        };
    }

    return {
        command: 'npm',
        args: ['run', 'dev']
    };
};

const isPortFree = (port) => new Promise((resolve) => {
    const tester = net.createServer()
        .once('error', (err) => {
            resolve(err.code !== 'EADDRINUSE');
        })
        .once('listening', () => {
            tester.close(() => resolve(true));
        })
        .listen(port);
});

const printPortHelp = (busyServices) => {
    console.error('\n❌ No se pudo iniciar porque hay puertos ocupados:\n');
    busyServices.forEach((service) => {
        console.error(`   - ${service.name}: puerto ${service.port}`);
    });
    console.error('\nCierra la terminal anterior del backend o libera esos puertos con PowerShell:');
    console.error(`   ${busyServices.map((service) => `Stop-Process -Id (Get-NetTCPConnection -LocalPort ${service.port}).OwningProcess -Force`).join('\n   ')}`);
    console.error('\nLuego ejecuta otra vez: npm run dev\n');
};

const startService = (service) => {
    const devCommand = getDevCommand();
    const child = spawn(devCommand.command, devCommand.args, {
        cwd: path.join(__dirname, service.dir),
        stdio: 'inherit'
    });

    child.on('error', (err) => {
        console.error(`❌ Fallo crítico en ${service.name}:`, err);
    });

    child.on('exit', (code) => {
        if (code !== 0) {
            console.error(`⚠️ ${service.name} se cerró con código ${code}.`);
        }
    });
};

(async () => {
    console.log('🚀 Iniciando ecosistema de microservicios...');

    const busyServices = [];
    for (const service of services) {
        const free = await isPortFree(service.port);
        if (!free) busyServices.push(service);
    }

    if (busyServices.length > 0) {
        printPortHelp(busyServices);
        process.exit(1);
    }

    const gateway = services.find((service) => service.name === 'GATEWAY');
    services
        .filter((service) => service.name !== 'GATEWAY')
        .forEach(startService);

    if (gateway) {
        setTimeout(() => {
            console.log('🚪 Iniciando gateway...');
            startService(gateway);
        }, 3000);
    }

    // Mantener el proceso padre vivo
    setInterval(() => {}, 1000 * 60 * 60);
})();
