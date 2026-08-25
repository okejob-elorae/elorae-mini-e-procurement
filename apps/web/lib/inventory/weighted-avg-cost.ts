export function weightedAvgCost(prevQty: number, prevAvg: number, addQty: number, addCost: number): number {
  const totalQty = prevQty + addQty;
  if (totalQty <= 0) return 0;
  return (prevQty * prevAvg + addQty * addCost) / totalQty;
}
