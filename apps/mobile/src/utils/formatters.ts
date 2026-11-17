/**
 * Currency, Date & Time Formatting Utilities
 */

/**
 * Formats integer paise into INR string representation (e.g. 150000 paise -> ₹1,500)
 */
export const formatPaiseToInr = (paise: number): string => {
  const inr = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: inr % 1 === 0 ? 0 : 2,
  }).format(inr);
};

/**
 * Formats remaining seconds into MM:SS display
 */
export const formatSecondsToTimer = (remainingSeconds: number): string => {
  const clamped = Math.max(0, remainingSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
