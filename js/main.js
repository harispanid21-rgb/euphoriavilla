function toggleMobileMenu() {
    const m = document.getElementById('mobile-menu');
    m.style.display = m.style.display === 'block' ? 'none' : 'block';
}
function closeMobileMenu() {
    document.getElementById('mobile-menu').style.display = 'none';
}

const ADMIN_HASH = '79f353d95cdeb42fb46b7966e4eb725dd41ffa917f2414d6e0e139b20b6fd1bf';

function toggleAdminPanel() {
    const p = document.getElementById('admin-price-panel');
    if (p) p.style.display = (p.style.display === 'block') ? 'none' : 'block';
}

async function checkAdminPassword() {
    const input = document.getElementById('admin-pw-input').value;
    const encoded = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (hashHex === ADMIN_HASH) {
        sessionStorage.setItem('adminAuth', '1');
        document.getElementById('admin-login-modal').style.display = 'none';
        const trigger = document.getElementById('admin-trigger');
        if (trigger) trigger.style.display = '';
        history.replaceState(null, '', window.location.pathname);
    } else {
        document.getElementById('admin-pw-error').style.display = 'block';
        document.getElementById('admin-pw-input').value = '';
    }
}

function checkAdminHash() {
    if (window.location.hash !== '#admin') return;
    const modal = document.getElementById('admin-login-modal');
    if (!modal) {
        window.location.href = 'book.html#admin';
        return;
    }
    if (sessionStorage.getItem('adminAuth') === '1') {
        const trigger = document.getElementById('admin-trigger');
        if (trigger) trigger.style.display = '';
        history.replaceState(null, '', window.location.pathname);
    } else {
        modal.style.display = 'flex';
        document.getElementById('admin-pw-input').focus();
    }
}

document.addEventListener('DOMContentLoaded', function () {
    checkAdminHash();
    const pwInput = document.getElementById('admin-pw-input');
    if (pwInput) {
        pwInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') checkAdminPassword();
        });
    }
});
window.addEventListener('hashchange', checkAdminHash);
