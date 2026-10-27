/**
 * Cloudflare Worker for the public, percentage-only R&H portfolio module.
 * Configure these secrets in the Worker dashboard:
 * - TWELVE_DATA_API_KEY
 * - PORTFOLIO_CONFIG: JSON with symbol, quantity and average_cost fields.
 * Optional: PORTFOLIO_HISTORY_URL, a JSON URL returning [{date, return}].
 */
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'public, max-age=900' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/portfolio') return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: cors });
    try {
      const portfolio = JSON.parse(env.PORTFOLIO_CONFIG || '[]');
      if (!Array.isArray(portfolio) || !portfolio.length) throw new Error('Portfolio configuration missing');
      const symbols = portfolio.map((position) => position.symbol).join(',');
      const quoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${env.TWELVE_DATA_API_KEY}`;
      const quoteResponse = await fetch(quoteUrl);
      const quotes = await quoteResponse.json();
      if (quotes.status === 'error') throw new Error(quotes.message || 'Quote request failed');
      const priced = portfolio.map((position) => {
        const quote = quotes[position.symbol];
        const close = Number(quote && quote.close);
        if (!Number.isFinite(close)) throw new Error(`Missing price for ${position.symbol}`);
        return { symbol: position.symbol, current: close, value: close * Number(position.quantity), return: ((close / Number(position.average_cost)) - 1) * 100 };
      });
      const total = priced.reduce((sum, position) => sum + position.value, 0);
      const holdings = priced.map((position) => ({ symbol: position.symbol, weight: (position.value / total) * 100, return: position.return }));
      let history = [];
      if (env.PORTFOLIO_HISTORY_URL) {
        const historyResponse = await fetch(env.PORTFOLIO_HISTORY_URL);
        if (historyResponse.ok) history = await historyResponse.json();
      }
      return new Response(JSON.stringify({
        as_of: new Date().toISOString().slice(0, 10),
        source: 'SOURCE / ROBINHOOD HOLDINGS EXPORT + TWELVE DATA',
        holdings,
        history
      }), { headers: cors });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Portfolio data unavailable' }), { status: 502, headers: cors });
    }
  }
};
