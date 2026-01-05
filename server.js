/**
 * API Otomatis untuk Data Drama Deeper.id (Vercel Ready)
 * Fitur: Scraper, In-Memory Caching, dan Express
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();

// Konfigurasi
const TARGET_URL = 'https://deeper.id';
const CACHE_DURATION = 10 * 60 * 1000; // Cache berlaku selama 10 menit (dalam milidetik)

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
        const { data } = await axios.get(TARGET_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 8000 // Timeout 8 detik untuk menghindari fungsi gantung di serverless
        });

        const $ = cheerio.load(data);
        const dramas = [];

        $('.card, .item, .drama-item').each((index, element) => {
            const title = $(element).find('h3, .title, a.name').first().text().trim();
            const episodes = $(element).find('.episode, .ep-status').first().text().trim();
            const description = $(element).find('.summary, .description, p').first().text().trim();
            const link = $(element).find('a').attr('href');
            
            const genres = [];
            $(element).find('.genre, .tag').each((i, el) => {
                genres.push($(el).text().trim());
            });

            if (title) {
                dramas.push({
                    id: index + 1,
                    title,
                    episodes: episodes || "N/A",
                    genres: genres.length > 0 ? genres : ["Drama"],
                    summary: description || "Tidak ada ringkasan.",
                    url: link ? (link.startsWith('http') ? link : `${TARGET_URL}${link}`) : null
                });
            }
        });

        return dramas;
    } catch (error) {
        console.error("Scraping Error:", error.message);
        throw new Error("Gagal mengambil data dari deeper.id");
    }
}

// --- ENDPOINTS ---

// 1. Dokumentasi Sederhana
app.get('/', (req, res) => {
    res.status(200).json({
        message: "API Deeper.id Scraper Aktif (Vercel)",
        cache_status: cachedData ? "Aktif" : "Kosong",
        last_update: lastFetchTime ? new Date(lastFetchTime).toISOString() : "Belum pernah",
        endpoints: {
            getAllDramas: "/api/dramas",
            search: "/api/search?q=keyword",
            clearCache: "/api/clear-cache"
        }
    });
});

// 2. Ambil data dengan Caching Logic
app.get('/api/dramas', async (req, res) => {
    const currentTime = Date.now();

    // Jika data ada di cache dan belum kadaluarsa, kirim dari cache
    if (cachedData && (currentTime - lastFetchTime < CACHE_DURATION)) {
        return res.status(200).json({
            status: "success",
            source: "cache",
            cached_at: new Date(lastFetchTime).toISOString(),
            total: cachedData.length,
            data: cachedData
        });
    }

    // Jika cache kosong atau kadaluarsa, lakukan scrape ulang
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
        // Jika scraping gagal tapi ada cache lama, kirim cache lama sebagai fallback
        if (cachedData) {
            return res.status(200).json({
                status: "warning",
                message: "Gagal refresh data, menampilkan data cache terakhir.",
                source: "old_cache",
                data: cachedData
            });
        }
        res.status(500).json({ status: "error", message: error.message });
    }
});

// 3. Search menggunakan data dari cache (cepat)
app.get('/api/search', async (req, res) => {
    const query = req.query.q ? req.query.q.toLowerCase() : '';
    
    try {
        // Pastikan ada data untuk dicari
        let dataToSearch = cachedData;
        if (!dataToSearch) {
            dataToSearch = await scrapeDeeperData();
            cachedData = dataToSearch;
            lastFetchTime = Date.now();
        }

        const filtered = dataToSearch.filter(d => 
            d.title.toLowerCase().includes(query) || 
            d.summary.toLowerCase().includes(query)
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

// 4. Manual Clear Cache (opsional)
app.get('/api/clear-cache', (req, res) => {
    cachedData = null;
    lastFetchTime = 0;
    res.json({ message: "Cache telah dibersihkan." });
});

/**
 * Konfigurasi untuk Vercel:
 * Vercel akan menggunakan export app ini sebagai handler.
 * Bagian app.listen hanya akan berjalan jika file dijalankan secara lokal.
 */
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server lokal berjalan di http://localhost:${PORT}`);
    });
}

module.exports = app;
