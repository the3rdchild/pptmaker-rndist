import { padStart } from 'lodash'

/**
 * Pad a number to the specified number of digits
 * @param digit the number
 * @param len the number of digits
 */
export const fillDigit = (digit: number, len: number) => {
  return padStart('' + digit, len, '0')
}

/**
 * Detect the device type
 */
export const isPC = () => {
  return !navigator.userAgent.match(/(iPhone|iPod|iPad|Android|Mobile|BlackBerry|Symbian|Windows Phone)/i)
}

/**
 * Validate a URL string
 */
export const isValidURL = (url: string) => {
  return /^(https?:\/\/)([\w-]+\.)+[\w-]{2,}(\/[\w-./?%&=]*)?$/i.test(url)
}

/**
 * Convert HTML to plain text
 */
export const htmlToText = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent || ''
}

/**
 * Floating point comparison
 */
export const isFloatEqual = (a: number, b: number, epsilon = 1e-10) => {
  return Math.abs(a - b) < epsilon
}

/**
 * Rounding with fixed decimal places
 */
export const toFixed = (num: number, fractionDigits = 1) => {
  if (num % 1 !== 0) {
    return parseFloat(num.toFixed(fractionDigits))
  } 
  return Math.floor(num)
}