// Pricing comes from a published Google Sheet CSV.
// Required columns: start_date, end_date, price
// Optional column: label
const PRICING_SHEET_CSV =
    'https://docs.google.com/spreadsheets/d/1d7b648X7TgWxJjZ8_pUTDaJjzSl7BiX30auv2VBZTZs/export?format=csv&gid=1168549662';

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

const AVAILABILITY_FEEDS = [
    {
        name: 'Airbnb',
        statusId: 'airbnb-status',
        url: 'https://www.airbnb.co.uk/calendar/ical/1660620875880657269.ics?t=565a1786098f4c759644d9008e8022c1',
    },
    {
        name: 'Booking.com',
        statusId: 'booking-status',
        url: 'https://ical.booking.com/v1/export?t=48dd88ab-ac97-4f0c-a00f-5e9e2882ca08',
    },
];

function addBlocked(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    bookedSet.add(dateKey(y, m - 1, d));
}

function parseBlockedIcal(ics) {
    const dates = [];
    ics.split('BEGIN:VEVENT').slice(1).forEach(chunk => {
        const sM = chunk.match(/DTSTART(?:;VALUE=DATE)?(?:;TZID=[^:]+)?:(\d{8})/);
        const eM = chunk.match(/DTEND(?:;VALUE=DATE)?(?:;TZID=[^:]+)?:(\d{8})/);
        if (!sM || !eM) return;
        let curr = toUTC(sM[1]);
        const stop = toUTC(eM[1]);
        while (curr < stop) {
            const y = curr.getUTCFullYear(), m = curr.getUTCMonth(), d = curr.getUTCDate();
            dates.push(`${y}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
            curr.setUTCDate(d + 1);
        }
    });
    return dates;
}

async function fetchProxy(url) {
    for (const proxy of PROXIES) {
        try {
            const r = await fetch(proxy + encodeURIComponent(url + '&nocache=' + Date.now()));
            if (!r.ok) continue;
            const text = await r.text();
            if (text && text.length > 100) return text;
        } catch {}
    }
    return null;
}

function setSourceStatus(feed, message, className = 'source-status') {
    const el = document.getElementById(feed.statusId);
    if (!el) return;
    el.className = className;
    el.innerText = message;
}

// Availability: load cached JSON immediately, then try live fetch in background
async function loadAvailability() {
    const status = document.getElementById('sync-status');
    AVAILABILITY_FEEDS.forEach(feed => setSourceStatus(feed, 'Checking calendar...'));

    // 1. Load cached JSON (fast, same-origin, always works)
    let cachedAt = null;
    try {
        const r = await fetch(`data/availability.json?nocache=${Date.now()}`);
        if (r.ok) {
            const data = await r.json();
            data.blocked.forEach(addBlocked);
            if (data.updated && data.updated !== '1970-01-01T00:00:00+00:00') {
                cachedAt = new Date(data.updated);
                status.innerHTML = `<span class="text-amber-500">↻ Checking live availability…</span>`;
            } else {
                status.innerHTML = `<span class="text-amber-500">⚠ Not yet synced — trigger the GitHub Action once</span>`;
            }
            AVAILABILITY_FEEDS.forEach(feed => setSourceStatus(feed, 'Using cached sync', 'source-status text-amber-500'));
            drawCal();
        }
    } catch {}

    // 2. Try live fetch via CORS proxy in background — update if it works
    const liveResults = await Promise.all(AVAILABILITY_FEEDS.map(async feed => ({
        feed,
        ics: await fetchProxy(feed.url),
    })));
    const anyLive = liveResults.some(result => result.ics);

    if (anyLive) {
        bookedSet.clear();
        liveResults.forEach(result => {
            if (result.ics) {
                parseBlockedIcal(result.ics).forEach(addBlocked);
                setSourceStatus(result.feed, 'Live availability loaded', 'source-status text-green-600');
            } else {
                setSourceStatus(result.feed, cachedAt ? 'Using cached sync' : 'Could not load feed', cachedAt ? 'source-status text-amber-500' : 'source-status text-red-500');
            }
        });
        status.innerHTML = `<span class="text-green-600">✓ Live availability loaded</span>`;
        drawCal();
    } else if (cachedAt) {
        status.innerHTML = `<span class="text-green-600">✓ Availability synced ${timeSince(cachedAt)}</span>`;
        AVAILABILITY_FEEDS.forEach(feed => setSourceStatus(feed, `Cached ${timeSince(cachedAt)}`, 'source-status text-green-600'));
    } else {
        status.innerHTML = `<span class="text-red-500">✗ Could not load availability — please refresh</span>`;
        AVAILABILITY_FEEDS.forEach(feed => setSourceStatus(feed, 'Could not load feed', 'source-status text-red-500'));
    }
}

// Pricing comes from the published Google Sheet CSV.
async function loadPricing() {
    const csv = await fetchRemoteText(PRICING_SHEET_CSV);
    if (!csv) {
        console.warn('Could not load Google Sheet pricing — using default rate');
        return;
    }

    parsePricingSheet(csv);
}

async function fetchRemoteText(url) {
    try {
        const direct = await fetch(`${url}&nocache=${Date.now()}`);
        if (direct.ok) {
            const text = await direct.text();
            if (text && text.length > 0) return text;
        }
    } catch {}

    return fetchProxy(url);
}

function parsePricingSheet(csv) {
    const rows = parseCsv(csv);
    if (rows.length < 2) return;

    const headers = rows[0].map(cell => cell.trim().toLowerCase());
    const startIndex = headers.indexOf('start_date');
    const endIndex = headers.indexOf('end_date');
    const priceIndex = headers.indexOf('price');

    if (startIndex === -1 || endIndex === -1 || priceIndex === -1) {
        console.warn('Pricing sheet is missing one of: start_date, end_date, price');
        return;
    }

    rows.slice(1).forEach((row, index) => {
        const startValue = row[startIndex]?.trim();
        const endValue = row[endIndex]?.trim();
        const priceValue = row[priceIndex]?.trim();

        if (!startValue && !endValue && !priceValue) return;

        const start = parseIsoDate(startValue);
        const end = parseIsoDate(endValue);
        const price = Number(priceValue);

        if (!start || !end || start > end || !Number.isFinite(price) || price <= 0) {
            console.warn(`Skipping invalid pricing row ${index + 2}`, row);
            return;
        }

        const cursor = new Date(start);
        while (cursor <= end) {
            dayPrices[dateKey(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate())] = Math.round(price);
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
    });
}

function toUTC(s) {
    return new Date(Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8)));
}

function parseIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function parseCsv(csv) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < csv.length; i++) {
        const char = csv[i];
        const next = csv[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                cell += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === ',' && !inQuotes) {
            row.push(cell);
            cell = '';
            continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') i += 1;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            continue;
        }

        cell += char;
    }

    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }

    return rows;
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
