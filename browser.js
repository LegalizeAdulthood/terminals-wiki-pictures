'use strict';

var fs = require('fs');
var path = require('path');
var process = require('process');
var puppeteer = require('puppeteer-extra');
var StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

function read_positive_int(value, default_value) {
    var parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return default_value;
}

function env_value(name) {
    return process.env[name] || process.env[name.toUpperCase()] || process.env[name.toLowerCase()];
}

function add_browser_candidate(candidates, base, relative_path) {
    if (base) {
        candidates.push(path.join(base, relative_path));
    }
}

function find_browser() {
    var configured = process.env.TERMINALS_BROWSER,
        candidates = [],
        i;

    if (configured) {
        if (!fs.existsSync(configured)) {
            throw new Error('TERMINALS_BROWSER does not exist: ' + configured);
        }
        return configured;
    }

    add_browser_candidate(candidates, env_value('ProgramFiles'), 'BraveSoftware\\Brave-Browser\\Application\\brave.exe');
    add_browser_candidate(candidates, env_value('ProgramFiles(x86)'), 'BraveSoftware\\Brave-Browser\\Application\\brave.exe');
    add_browser_candidate(candidates, env_value('LocalAppData'), 'BraveSoftware\\Brave-Browser\\Application\\brave.exe');
    add_browser_candidate(candidates, env_value('ProgramFiles'), 'Google\\Chrome\\Application\\chrome.exe');
    add_browser_candidate(candidates, env_value('ProgramFiles(x86)'), 'Google\\Chrome\\Application\\chrome.exe');
    add_browser_candidate(candidates, env_value('LocalAppData'), 'Google\\Chrome\\Application\\chrome.exe');
    add_browser_candidate(candidates, env_value('ProgramFiles'), 'Microsoft\\Edge\\Application\\msedge.exe');
    add_browser_candidate(candidates, env_value('ProgramFiles(x86)'), 'Microsoft\\Edge\\Application\\msedge.exe');

    for (i = 0; i < candidates.length; ++i) {
        if (fs.existsSync(candidates[i])) {
            return candidates[i];
        }
    }

    return puppeteer.executablePath();
}

function default_browser_profile_name(browser_exe) {
    if (/brave\.exe$/i.test(browser_exe || '')) {
        return '.browser-profile-brave';
    }
    return '.browser-profile';
}

function default_profile() {
    var browser_exe = find_browser();
    return process.env.TERMINALS_BROWSER_PROFILE ||
        path.join(__dirname, default_browser_profile_name(browser_exe));
}

function delay(ms) {
    return new Promise(
        function(resolve) {
            setTimeout(resolve, ms);
        });
}

async function configure_page(page, options) {
    var timeout = options.timeout || 30000;

    page.setDefaultNavigationTimeout(timeout);
    page.setDefaultTimeout(timeout);

    await page.setViewport({ width: 1366, height: 900 });
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
    });

    if (options.user_agent) {
        await page.setUserAgent(options.user_agent);
    }
}

async function page_html_contains(page, text) {
    return await page.evaluate(
        function(needle) {
            return document.documentElement.outerHTML.indexOf(needle) !== -1;
        },
        text);
}

async function wait_for_page_content(page, options) {
    var timeout = options.timeout || 30000,
        expression = options.wait_expression,
        start,
        waited;

    if (!expression) {
        await delay(options.wait_after_load || 1500);
        return;
    }

    try {
        await page.waitForFunction(expression, { timeout: timeout });
    } catch (err) {
        if (options.headless !== false) {
            throw err;
        }

        console.log('Waiting up to ' + Math.ceil(timeout / 1000) + ' seconds for the browser page to become readable...');
        await page.bringToFront().catch(function() {});

        start = Date.now();
        waited = 0;
        while (Date.now() - start < timeout) {
            await delay(2000);

            if (Date.now() - start - waited >= 15000) {
                waited = Date.now() - start;
                console.log('Still waiting for browser page content (' + Math.floor(waited / 1000) + 's)');
            }

            try {
                await page.waitForFunction(expression, { timeout: 1000 });
                return;
            } catch (ignored) {
                if (await page_html_contains(page, 'i.ebayimg.com')) {
                    return;
                }
            }
        }

        throw err;
    }

    await delay(options.wait_after_load || 1000);
}

async function fetch_dom_async(url, options) {
    var browser_exe = find_browser(),
        headless = options.headless !== false,
        profile = options.profile || default_profile(),
        browser,
        page,
        html;

    browser = await puppeteer.launch({
        executablePath: browser_exe,
        headless: headless ? 'new' : false,
        userDataDir: profile,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1366,900'
        ]
    });

    try {
        page = await browser.newPage();
        await configure_page(page, options);

        if (!headless) {
            console.log('Browser executable: ' + browser_exe);
            console.log('Browser profile: ' + profile);
        }

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: options.timeout || 30000
        });

        await wait_for_page_content(page, options);
        html = await page.content();
    } finally {
        await browser.close();
    }

    return html;
}

function fetch_dom(url, options, callback) {
    fetch_dom_async(url, options || {})
        .then(
            function(html) {
                callback(null, html);
            })
        .catch(callback);
}

exports.fetch_dom = fetch_dom;
exports.find_browser = find_browser;
exports.default_profile = default_profile;
