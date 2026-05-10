// NOTE: iCal tokens are inherently visible in a static site's source.
// To fully hide them, proxy the feeds server-side (e.g. a Netlify/Vercel function).
const ICAL_FEEDS = [
    'https://www.airbnb.co.uk/calendar/ical/1660620875880657269.ics?t=565a1786098f4c759644d9008e8022c1',
    'https://ical.booking.com/v1/export?t=48dd88ab-ac97-4f0c-a00f-5e9e2882ca08'
];

let globalRate = 200;
let dayOverrides = {};
let bookedSet = new Set();
let calDate = new Date();
let selection = [];
let activeKey = null;

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('global-rate-field').value = globalRate;
});

function openTerms() { document.getElementById('termsModal').style.display = 'block'; }
function closeTerms() { document.getElementById('termsModal').style.display = 'none'; }

function changeGlobalRate(v) { globalRate = parseInt(v) || 0; drawCal(); }
function changeDayOverride(v) { if (activeKey) { dayOverrides[activeKey] = parseInt(v); drawCal(); } }

async function syncAvail() {
    const proxies = [
        'https://corsproxy.io/?',
        'https://api.allorigins.win/raw?url='
    ];
    bookedSet.clear();
    for (let url of ICAL_FEEDS) {
        let fetched = false;
        for (let proxy of proxies) {
            if (fetched) break;
            try {
                const finalUrl = proxy + encodeURIComponent(url + '&nocache=' + Date.now());
                const r = await fetch(finalUrl);
                if (!r.ok) continue;
                const t = await r.text();
                if (!t || t.length < 100) continue;
                const chunks = t.split('BEGIN:VEVENT');
                chunks.shift();
                chunks.forEach(c => {
                    const sMatch = c.match(/DTSTART(?:;VALUE=DATE)?:(\d{8})/);
                    const eMatch = c.match(/DTEND(?:;VALUE=DATE)?:(\d{8})/);
                    if (sMatch && eMatch) {
                        const s = sMatch[1], e = eMatch[1];
                        let curr = new Date(Date.UTC(+s.substring(0,4), +s.substring(4,6)-1, +s.substring(6,8)));
                        let stop = new Date(Date.UTC(+e.substring(0,4), +e.substring(4,6)-1, +e.substring(6,8)));
                        while (curr < stop) {
                            bookedSet.add(`${curr.getUTCFullYear()}-${curr.getUTCMonth()}-${curr.getUTCDate()}`);
                            curr.setUTCDate(curr.getUTCDate() + 1);
                        }
                    }
                });
                fetched = true;
                console.log('Synced via: ' + proxy);
            } catch (err) {
                console.error('Proxy ' + proxy + ' failed');
            }
        }
    }
    drawCal();
}

const mNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function drawCal() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';
    document.getElementById('current-month').innerText = `${mNames[calDate.getMonth()]} ${calDate.getFullYear()}`;
    ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach(h => grid.innerHTML += `<div class="text-[10px] font-bold text-gray-300 mb-4">${h}</div>`);
    let startDay = new Date(calDate.getFullYear(), calDate.getMonth(), 1).getDay();
    let totalDays = new Date(calDate.getFullYear(), calDate.getMonth()+1, 0).getDate();
    let offset = startDay === 0 ? 6 : startDay - 1;
    for (let i = 0; i < offset; i++) grid.innerHTML += `<div></div>`;
    const today = new Date(); today.setHours(0,0,0,0);
    for (let d = 1; d <= totalDays; d++) {
        let key = `${calDate.getFullYear()}-${calDate.getMonth()}-${d}`;
        let isBooked = bookedSet.has(key);
        let isSelected = selection.includes(key);
        let price = dayOverrides[key] || globalRate;
        let cellDate = new Date(calDate.getFullYear(), calDate.getMonth(), d);
        const day = document.createElement('div');
        day.className = `cal-day ${isBooked || cellDate < today ? 'booked' : ''} ${isSelected ? 'selected' : ''}`;
        day.innerHTML = `<span>${d}</span><span class="day-price">€${price}</span>`;
        if (!isBooked && cellDate >= today) {
            day.onclick = () => {
                activeKey = key;
                document.getElementById('edit-date-label').innerText = `Date: ${d} ${mNames[calDate.getMonth()]}`;
                document.getElementById('single-day-field').disabled = false;
                document.getElementById('single-day-field').value = price;
                handleDateSelection(key, d);
            };
        }
        grid.appendChild(day);
    }
    updateTotalQuote();
}

function handleDateSelection(key, d) {
    const label = `${d} ${mNames[calDate.getMonth()].substring(0,3)} ${calDate.getFullYear()}`;
    if (selection.length !== 1) {
        selection = [key];
        document.getElementById('in-display').value = label;
        document.getElementById('out-display').value = '';
    } else {
        let startK = selection[0].split('-');
        let s = new Date(+startK[0], +startK[1], +startK[2]);
        let c = new Date(calDate.getFullYear(), calDate.getMonth(), d);
        if (c <= s) {
            selection = [key];
            document.getElementById('in-display').value = label;
        } else {
            selection = [];
            let curr = new Date(s);
            while (curr <= c) {
                selection.push(`${curr.getFullYear()}-${curr.getMonth()}-${curr.getDate()}`);
                curr.setDate(curr.getDate() + 1);
            }
            document.getElementById('out-display').value = label;
        }
    }
    drawCal();
}

function updateTotalQuote() {
    const box = document.getElementById('total-box');
    const submitBtn = document.getElementById('submit-btn');
    const termsChecked = document.getElementById('terms-check').checked;
    if (selection.length < 2) {
        box.classList.add('hidden');
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.style.cursor = 'not-allowed';
        return;
    }
    if (selection.length < 4) {
        box.innerText = 'MINIMUM STAY: 3 NIGHTS REQUIRED';
        box.classList.remove('hidden');
        box.style.backgroundColor = '#ff4444';
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.innerText = '3 NIGHTS MINIMUM REQUIRED';
        submitBtn.style.cursor = 'not-allowed';
        return;
    }
    let sum = 0;
    for (let i = 0; i < selection.length - 1; i++) { sum += (dayOverrides[selection[i]] || globalRate); }
    box.innerText = `TOTAL STAY: €${sum}`;
    box.style.backgroundColor = '#000080';
    box.classList.remove('hidden');
    if (termsChecked) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
        submitBtn.innerText = 'SUBMIT REQUEST';
    } else {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.style.cursor = 'not-allowed';
        submitBtn.innerText = 'PLEASE ACCEPT TERMS';
    }
    document.getElementById('price-hidden').value = `€${sum}`;
}

function navMonth(n) { calDate.setMonth(calDate.getMonth() + n); drawCal(); }

window.onload = syncAvail;
