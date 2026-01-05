/**
 * API Otomatis untuk Data Drama Deeper.id (Vercel Ready)
 * Fitur: Scraper (Heuristic Mode), In-Memory Caching, Express, dan Status Dashboard
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();

// Konfigurasi
const TARGET_URL = 'https://deeper.id';
const CACHE_DURATION = 10 * 60 * 1000; // Cache berlaku selama 10 menit

// State untuk Caching
let cachedData = null;
let lastFetchTime = 0;

app.use(express.json());
app.use(cors());

/**
 * Fungsi Helper untuk melakukan scraping
 */
async function scrapeDeeperData() {
    try {
        console.log(`[SCRAPER] Memulai request ke ${TARGET_URL}...`);
        
        const { data } = await axios.get(TARGET_URL, {
            headers: {
                // User-Agent yang lebih lengkap menyerupai browser asli
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
            },
            timeout: 10000 // Naikkan timeout jadi 10 detik
        });

        const $ = cheerio.load(data);
        const dramas = [];
        
        // DEBUG: Cek Title Halaman untuk memastikan tidak di-blokir (misal: "Just a moment..." dari Cloudflare)
        const pageTitle = $('title').text().trim();
        console.log(`[SCRAPER] Judul Halaman yang didapat: "${pageTitle}"`);

        // METODE 1: Selektor Spesifik (Coba beberapa kemungkinan kelas umum)
        // Kita perlu mencari container utama dulu
        let items = $('.card, .item, .drama-item, .post, .box, article, .list-item');

        // METODE 2: HEURISTIK (Jika metode kelas gagal)
        // Cari semua elemen <a> yang memiliki <img> di dalamnya (Pola umum thumbnail video)
        if (items.length === 0) {
            console.log("[SCRAPER] Selektor kelas tidak ditemukan. Beralih ke mode Heuristik (Link + Image)...");
            // Cari div yang membungkus img dan text, atau langsung a tag
            items = $('a:has(img)'); 
        }

        console.log(`[SCRAPER] Menemukan ${items.length} potensi elemen.`);

        items.each((index, element) => {
            // Logika ekstraksi yang lebih defensif (mencegah error jika elemen kosong)
            const el = $(element);
            
            // 1. Coba ambil Judul
            // Prioritas: atribut title di <a> -> alt di <img> -> text di heading -> text di elemen itu sendiri
            let title = el.attr('title') || 
                        el.find('img').attr('alt') || 
                        el.find('h1, h2, h3, h4, .title, .name').text().trim() ||
                        el.text().trim();

            // 2. Coba ambil Link
            let link = el.attr('href') || el.find('a').attr('href');
            
            // 3. Coba ambil Episode (biasanya ada angka di pojok gambar)
            let episodes = el.find('.episode, .ep, .status, span:contains("Ep"), .badge').text().trim();
            
            // 4. Coba ambil Gambar
            let image = el.find('img').attr('src') || el.find('img').attr('data-src');

            // Filter: Hanya masukkan jika punya judul yang valid dan panjangnya masuk akal
            if (title && title.length > 2 && link && !title.toLowerCase().includes("home")) {
                // Bersihkan URL (kadang relatif)
                if (link && !link.startsWith('http')) {
                    link = link.startsWith('/') ? `${TARGET_URL}${link}` : `${TARGET_URL}/${link}`;
                }
                
                // Bersihkan Image URL
                if (image && !image.startsWith('http')) {
                    image = image.startsWith('//') ? `https:${image}` : image;
                }

                dramas.push({
                    id: index + 1,
                    title: title,
                    episodes: episodes || "Unknown",
                    genres: ["Drama"], // Genre sulit diambil secara generik di list view
                    summary: "Lihat detail di link asli.",
                    image: image || null,
                    url: link
                });
            }
        });

        // Hapus duplikat berdasarkan URL (karena metode heuristik mungkin mengambil elemen ganda)
        const uniqueDramas = Array.from(new Map(dramas.map(item => [item['url'], item])).values());
        
        console.log(`[SCRAPER] Berhasil memproses ${uniqueDramas.length} data unik.`);
        return uniqueDramas;

    } catch (error) {
        console.error("[SCRAPER ERROR]", error.message);
        // Jika error 403, beri pesan spesifik soal Cloudflare
        if (error.response && error.response.status === 403) {
            throw new Error("Akses ditolak (403). Website mungkin diproteksi Cloudflare.");
        }
        throw new Error("Gagal mengambil data dari deeper.id");
    }
}

// --- ENDPOINTS ---

// 1. ROOT: Menampilkan Dashboard Status (HTML)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. API STATUS: Data JSON untuk Dashboard
app.get('/api/status', (req, res) => {
    res.status(200).json({
        status: "online",
        message: "API Deeper.id Scraper Aktif",
        cache_status: cachedData ? "Active (In Memory)" : "Empty",
        last_update: lastFetchTime ? new Date(lastFetchTime).toISOString() : null,
        total_items: cachedData ? cachedData.length : 0,
        endpoints: {
            getAllDramas: "/api/dramas",
            search: "/api/search?q=keyword",
            clearCache: "/api/clear-cache"
        }
    });
});

// 3. Ambil data dengan Caching Logic
app.get('/api/dramas', async (req, res) => {
    const currentTime = Date.now();

    if (cachedData && (currentTime - lastFetchTime < CACHE_DURATION)) {
        console.log("[API] Melayani dari Cache");
        return res.status(200).json({
            status: "success",
            source: "cache",
            cached_at: new Date(lastFetchTime).toISOString(),
            total: cachedData.length,
            data: cachedData
        });
    }

    try {
        const freshData = await scrapeDeeperData();
        cachedData = freshData;
        lastFetchTime = currentTime;

        res.status(200).json({
            status: "success",
            source: "live_scraping",
            total: freshData.length,
            data: freshData
        });
    } catch (error) {
        if (cachedData) {
            return res.status(200).json({
                status: "warning",
                message: "Gagal refresh data, menampilkan data cache terakhir.",
                error_detail: error.message,
                source: "old_cache",
                data: cachedData
            });
        }
        res.status(500).json({ status: "error", message: error.message });
    }
});

// 4. Search
app.get('/api/search', async (req, res) => {
    const query = req.query.q ? req.query.q.toLowerCase() : '';
    
    try {
        let dataToSearch = cachedData;
        if (!dataToSearch) {
            dataToSearch = await scrapeDeeperData();
            cachedData = dataToSearch;
            lastFetchTime = Date.now();
        }

        const filtered = dataToSearch.filter(d => 
            d.title.toLowerCase().includes(query)
        );

        res.status(200).json({
            status: "success",
            query: query,
            total_found: filtered.length,
            data: filtered
        });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

// 5. Clear Cache
app.get('/api/clear-cache', (req, res) => {
    cachedData = null;
    lastFetchTime = 0;
    res.json({ message: "Cache telah dibersihkan." });
});

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server lokal berjalan di http://localhost:${PORT}`);
    });
}

module.exports = app;
