// Pricing: Google Calendar public iCal URL.
// In Google Calendar: Settings → your calendar → "Public address in iCal format"
// Add all-day events with just the nightly rate as the title, e.g. "280"
const PRICING_FEED = 'YOUR_GOOGLE_CALENDAR_ICAL_URL';

const DEFAULT_RATE = 200;
const MIN_NIGHTS = 3;
const PROXIES = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url='
];

let bookedSet = new Set();
let dayPrices = {};
let calDate = new Date();
let selection = [];

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function dateKey(y, m, d) { return `${y}-${m}-${d}`; }

// Availability comes from data/availability.json (written by GitHub Action — no CORS proxy needed)
async function loadAvailability() {
    const status = document.getElementById('sync-status');
    try {
        const r = await fetch(`data/availability.json?nocache=${Date.now()}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();

        data.blocked.forEach(iso => {
            const [y, m, d] = iso.split('-').map(Number);
            bookedSet.add(dateKey(y, m - 1, d));
        });

        if (data.updated && data.updated !== '1970-01-01T00:00:00+00:00') {
            const ago = timeSince(new Date(data.updated));
            status.innerHTML = `<span class="text-green-600">✓ Availability synced ${ago}</span>`;
        } else {
            status.innerHTML = `<span class="text-amber-500">⚠ Availability not yet synced — run the GitHub Action once</span>`;
        }
    } catch (e) {
        console.error('Availability load failed:', e);
        status.innerHTML = `<span class="text-red-500">✗ Could not load availability</span>`;
    }
}

// Pricing comes from Google Calendar via CORS proxy (optional)
async function loadPricing() {
    if (PRICING_FEED === 'YOUR_GOOGLE_CALENDAR_ICAL_URL') return;
    for (const proxy of PROXIES) {
        try {
            const r = await fetch(proxy + encodeURIComponent(PRICING_FEED + '&nocache=' + Date.now()));
            if (!r.ok) continue;
            const text = await r.text();
            if (text && text.length > 100) { parsePricing(text); return; }
        } catch {}
    }
    console.warn('Could not load pricing calendar — using default rate');
}

function parsePricing(ics) {
    ics.split('BEGIN:VEVENT').slice(1).forEach(chunk => {
        const sM = chunk.match(/DTSTART(?:;VALUE=DATE)?:(\d{8})/);
        const eM = chunk.match(/DTEND(?:;VALUE=DATE)?:(\d{8})/);
        const priceM = chunk.match(/SUMMARY:(\d+)/);
        if (!sM || !eM || !priceM) return;
        const price = parseInt(priceM[1]);
        let curr = toUTC(sM[1]);
        const stop = toUTC(eM[1]);
        while (curr < stop) {
            dayPrices[dateKey(curr.getUTCFullYear(), curr.getUTCMonth(), curr.getUTCDate())] = price;
            curr.setUTCDate(curr.getUTCDate() + 1);
        }
    });
}

function toUTC(s) {
    return new Date(Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8)));
}

function timeSince(date) {
    const mins = Math.floor((Date.now() - date) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

async function init() {
    await Promise.all([loadAvailability(), loadPricing()]);
    drawCal();
}

function drawCal() {
    const grid = document.getElementById('cal-grid');
    grid.innerHTML = '';
    document.getElementById('cal-month').innerText = `${MONTHS[calDate.getMonth()]} ${calDate.getFullYear()}`;

    ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach(h => {
        const el = document.createElement('div');
        el.className = 'text-[10px] font-bold text-gray-300 mb-2 text-center';
        el.innerText = h;
        grid.appendChild(el);
    });

    const firstDay = new Date(calDate.getFullYear(), calDate.getMonth(), 1).getDay();
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    const totalDays = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0).getDate();

    for (let i = 0; i < offset; i++) grid.appendChild(document.createElement('div'));

    const today = new Date(); today.setHours(0,0,0,0);

    for (let d = 1; d <= totalDays; d++) {
        const key = dateKey(calDate.getFullYear(), calDate.getMonth(), d);
        const cellDate = new Date(calDate.getFullYear(), calDate.getMonth(), d);
        const isPast = cellDate < today;
        const isBooked = bookedSet.has(key);
        const isEndpoint = selection[0] === key || selection[selection.length - 1] === key;
        const inRange = selection.length > 1 && selection.includes(key) && !isEndpoint;
        const price = dayPrices[key] || DEFAULT_RATE;

        const day = document.createElement('div');
        day.className = `cal-day ${isPast || isBooked ? 'booked' : ''} ${isEndpoint ? 'selected' : ''} ${inRange ? 'in-range' : ''}`;
        day.innerHTML = `<span>${d}</span>${!isPast && !isBooked ? `<span class="day-price">€${price}</span>` : ''}`;

        if (!isPast && !isBooked) day.onclick = () => selectDate(key, d, price);
        grid.appendChild(day);
    }
}

function selectDate(key, d, price) {
    const label = `${d} ${MONTHS[calDate.getMonth()].slice(0,3)} ${calDate.getFullYear()}`;

    if (selection.length === 0 || selection.length > 1) {
        selection = [key];
        setDisplay('arrival-display', label);
        setDisplay('departure-display', '—');
        setHidden('arrival-hidden', label);
        setHidden('departure-hidden', '');
        updateSummary(); drawCal(); return;
    }

    const [sy, sm, sd] = selection[0].split('-').map(Number);
    const start = new Date(sy, sm, sd);
    const clicked = new Date(calDate.getFullYear(), calDate.getMonth(), d);

    if (clicked <= start) {
        selection = [key];
        setDisplay('arrival-display', label);
        setDisplay('departure-display', '—');
        setHidden('arrival-hidden', label);
        setHidden('departure-hidden', '');
        updateSummary(); drawCal(); return;
    }

    // Build range — abort if a booked day falls inside it
    const range = [];
    let curr = new Date(start);
    while (curr <= clicked) {
        const k = dateKey(curr.getFullYear(), curr.getMonth(), curr.getDate());
        if (bookedSet.has(k) && curr > start && curr < clicked) {
            selection = [key];
            setDisplay('arrival-display', label);
            setDisplay('departure-display', '—');
            setHidden('arrival-hidden', label);
            setHidden('departure-hidden', '');
            updateSummary(); drawCal(); return;
        }
        range.push(k);
        curr.setDate(curr.getDate() + 1);
    }

    selection = range;
    setDisplay('departure-display', label);
    setHidden('departure-hidden', label);
    updateSummary(); drawCal();
}

function setDisplay(id, val) { const el = document.getElementById(id); if (el) el.innerText = val; }
function setHidden(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

function updateSummary() {
    const box = document.getElementById('stay-summary');
    const btn = document.getElementById('submit-btn');
    const nights = Math.max(0, selection.length - 1);

    if (nights === 0) {
        box.classList.add('hidden');
        btn.disabled = true;
        btn.innerText = 'Select Dates First';
        return;
    }
    if (nights < MIN_NIGHTS) {
        box.innerText = `Minimum stay is ${MIN_NIGHTS} nights`;
        box.className = 'mt-6 p-4 text-center text-sm font-bold text-white bg-red-400';
        box.classList.remove('hidden');
        btn.disabled = true;
        btn.innerText = `${MIN_NIGHTS} Nights Minimum`;
        return;
    }

    let total = 0;
    for (let i = 0; i < nights; i++) total += dayPrices[selection[i]] || DEFAULT_RATE;

    box.innerText = `${nights} night${nights > 1 ? 's' : ''} — Total: €${total}`;
    box.className = 'mt-6 p-4 text-center text-sm font-bold text-white bg-[#000080]';
    box.classList.remove('hidden');
    btn.disabled = false;
    btn.innerText = 'Submit Request';
}

function navMonth(n) { calDate.setMonth(calDate.getMonth() + n); drawCal(); }

async function handleSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    btn.innerText = 'Sending…';
    btn.disabled = true;

    try {
        const res = await fetch('https://api.web3forms.com/submit', { method: 'POST', body: new FormData(e.target) });
        const json = await res.json();
        if (json.success) {
            document.getElementById('booking-form').innerHTML =
                '<div class="py-12 text-center"><p class="serif text-2xl text-[#000080] mb-2">Request Sent</p><p class="text-gray-500 text-sm">We\'ll be in touch shortly.</p></div>';
        } else { throw new Error(); }
    } catch {
        btn.innerText = 'Submit Request';
        btn.disabled = false;
        document.getElementById('form-error').classList.remove('hidden');
    }
}

window.addEventListener('load', init);
