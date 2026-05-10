// NOTE: iCal tokens are visible in static site source.
// To hide them fully, proxy server-side (e.g. Netlify/Vercel function).
const AVAILABILITY_FEEDS = [
    'https://www.airbnb.co.uk/calendar/ical/1660620875880657269.ics?t=565a1786098f4c759644d9008e8022c1',
    'https://ical.booking.com/v1/export?t=48dd88ab-ac97-4f0c-a00f-5e9e2882ca08'
];

// Add your Google Calendar public iCal URL here.
// In Google Calendar: Settings → your calendar → "Public address in iCal format"
// Create all-day events with just the nightly rate as the title, e.g. "280"
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

function toUTC(s) {
    return new Date(Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8)));
}
function dateKey(d) {
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

async function fetchIcal(url) {
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

function parseBlocked(ics) {
    ics.split('BEGIN:VEVENT').slice(1).forEach(chunk => {
        const sM = chunk.match(/DTSTART(?:;VALUE=DATE)?:(\d{8})/);
        const eM = chunk.match(/DTEND(?:;VALUE=DATE)?:(\d{8})/);
        if (!sM || !eM) return;
        let curr = toUTC(sM[1]);
        const stop = toUTC(eM[1]);
        while (curr < stop) {
            bookedSet.add(dateKey(curr));
            curr.setUTCDate(curr.getUTCDate() + 1);
        }
    });
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
            dayPrices[dateKey(curr)] = price;
            curr.setUTCDate(curr.getUTCDate() + 1);
        }
    });
}

async function init() {
    const fetches = [
        fetchIcal(AVAILABILITY_FEEDS[0]),
        fetchIcal(AVAILABILITY_FEEDS[1]),
        PRICING_FEED !== 'YOUR_GOOGLE_CALENDAR_ICAL_URL' ? fetchIcal(PRICING_FEED) : Promise.resolve(null)
    ];
    const [airbnb, booking, pricing] = await Promise.all(fetches);
    if (airbnb) parseBlocked(airbnb);
    if (booking) parseBlocked(booking);
    if (pricing) parsePricing(pricing);
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
        const key = `${calDate.getFullYear()}-${calDate.getMonth()}-${d}`;
        const cellDate = new Date(calDate.getFullYear(), calDate.getMonth(), d);
        const isPast = cellDate < today;
        const isBooked = bookedSet.has(key);
        const isSelected = selection[0] === key || selection[selection.length - 1] === key;
        const inRange = selection.length > 1 && selection.includes(key) && !isSelected;
        const price = dayPrices[key] || DEFAULT_RATE;

        const day = document.createElement('div');
        day.className = `cal-day ${isPast || isBooked ? 'booked' : ''} ${isSelected ? 'selected' : ''} ${inRange ? 'in-range' : ''}`;
        day.innerHTML = `<span>${d}</span>${!isPast && !isBooked ? `<span class="day-price">€${price}</span>` : ''}`;

        if (!isPast && !isBooked) {
            day.onclick = () => selectDate(key, d, price);
        }
        grid.appendChild(day);
    }
}

function selectDate(key, d, price) {
    const label = `${d} ${MONTHS[calDate.getMonth()].slice(0,3)} ${calDate.getFullYear()}`;

    if (selection.length === 0 || selection.length > 1) {
        selection = [key];
        setDisplay('arrival-display', label);
        setDisplay('departure-display', '');
        setHidden('arrival-hidden', label);
        setHidden('departure-hidden', '');
        updateSummary();
        drawCal();
        return;
    }

    const startK = selection[0].split('-');
    const start = new Date(+startK[0], +startK[1], +startK[2]);
    const clicked = new Date(calDate.getFullYear(), calDate.getMonth(), d);

    if (clicked <= start) {
        selection = [key];
        setDisplay('arrival-display', label);
        setDisplay('departure-display', '');
        setHidden('arrival-hidden', label);
        setHidden('departure-hidden', '');
        updateSummary();
        drawCal();
        return;
    }

    // Build range, abort if a booked day is in between
    selection = [];
    let curr = new Date(start);
    while (curr <= clicked) {
        const k = `${curr.getFullYear()}-${curr.getMonth()}-${curr.getDate()}`;
        if (bookedSet.has(k) && curr > start && curr < clicked) {
            selection = [key];
            setDisplay('arrival-display', label);
            setDisplay('departure-display', '');
            setHidden('arrival-hidden', label);
            setHidden('departure-hidden', '');
            updateSummary();
            drawCal();
            return;
        }
        selection.push(k);
        curr.setDate(curr.getDate() + 1);
    }

    setDisplay('departure-display', label);
    setHidden('departure-hidden', label);
    updateSummary();
    drawCal();
}

function setDisplay(id, val) {
    const el = document.getElementById(id);
    if (el) el.innerText = val || '—';
}
function setHidden(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function updateSummary() {
    const box = document.getElementById('stay-summary');
    const btn = document.getElementById('submit-btn');
    const nights = selection.length - 1;

    if (selection.length < 2) {
        box.classList.add('hidden');
        btn.disabled = true;
        return;
    }
    if (nights < MIN_NIGHTS) {
        box.innerText = `Minimum stay is ${MIN_NIGHTS} nights`;
        box.className = 'p-4 text-center text-sm font-bold text-white bg-red-400';
        btn.disabled = true;
        return;
    }

    let total = 0;
    for (let i = 0; i < nights; i++) {
        const k = selection[i];
        total += dayPrices[k] || DEFAULT_RATE;
    }
    box.innerText = `${nights} nights — Total: €${total}`;
    box.className = 'p-4 text-center text-sm font-bold text-white bg-[#000080]';
    btn.disabled = false;
}

function navMonth(n) {
    calDate.setMonth(calDate.getMonth() + n);
    drawCal();
}

async function handleSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    btn.innerText = 'SENDING…';
    btn.disabled = true;

    const data = new FormData(e.target);
    try {
        const res = await fetch('https://api.web3forms.com/submit', { method: 'POST', body: data });
        const json = await res.json();
        if (json.success) {
            document.getElementById('booking-form').innerHTML =
                '<div class="py-12 text-center"><p class="serif text-2xl text-[#000080] mb-2">Request Sent</p><p class="text-gray-500 text-sm">We\'ll be in touch shortly.</p></div>';
        } else {
            throw new Error();
        }
    } catch {
        btn.innerText = 'SUBMIT REQUEST';
        btn.disabled = false;
        document.getElementById('form-error').classList.remove('hidden');
    }
}

window.addEventListener('load', init);
