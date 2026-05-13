// 股 / 張 換算。1 張 = 1000 股，固定值。
// 全程用 INTEGER 計算，僅在「顯示」邊界轉換。

const SHARES_PER_LOT = 1000;

function sharesToLots(shares) {
  if (!Number.isInteger(shares)) throw new TypeError('shares must be integer');
  return shares / SHARES_PER_LOT; // 顯示用：允許小數，例如 0.5 張
}

function lotsToShares(lots) {
  if (typeof lots !== 'number' || Number.isNaN(lots)) throw new TypeError('lots must be number');
  const shares = Math.round(lots * SHARES_PER_LOT);
  return shares;
}

module.exports = { SHARES_PER_LOT, sharesToLots, lotsToShares };
