import { storeToRefs } from 'pinia'
import { useKeyboardStore } from '@/store'
import { pasteCustomClipboardString } from '@/utils/clipboard'
import { parseText2Paragraphs } from '@/utils/textParser'
import { getImageDataURL, isSVGString, svg2File } from '@/utils/image'
import { isValidURL } from '@/utils/common'
import useCreateElement from '@/hooks/useCreateElement'
import useAddSlidesOrElements from '@/hooks/useAddSlidesOrElements'

interface PasteTextClipboardDataOptions {
  onlySlide?: boolean
  onlyElements?: boolean
}

/**
 * Determine if the image URL string is valid
 *
 * !!! Note: you need to determine which sources of image URLs are allowed to be matched, then write your own regular expression
 * !!! You must ensure that all image sources are legal, reliable, controllable, and have no access restrictions
 */
const isValidImgURL = (url: string) => {
  const pexels = /^https?:\/\/(?:[a-zA-Z0-9-]+\.)*pexels\.com\/[^\s]+\.(?:jpg|jpeg|png|svg|webp)(?:\?.*)?$/i.test(url)
  const pptist = /^https?:\/\/(?:[a-zA-Z0-9-]+\.)*pptist\.cn\/[^\s]+\.(?:jpg|jpeg|png|svg|webp)(?:\?.*)?$/i.test(url)
  return pexels || pptist
}

export default () => {
  const { shiftKeyState } = storeToRefs(useKeyboardStore())

  const { createTextElement, createImageElement } = useCreateElement()
  const { addElementsFromData, addSlidesFromData } = useAddSlidesOrElements()

  /**
   * Paste plain text: create it as a new text element
   * @param text Text
   */
  const createTextElementFromClipboard = (text: string) => {
    createTextElement({
      left: 0,
      top: 0,
      width: 600,
      height: 50,
    }, { content: text })
  }

  /**
   * Parse the clipboard content and choose the appropriate paste method based on the parsing result
   * @param text Clipboard content
   * @param options Config options: onlySlide -- only handle slide paste; onlyElements -- only handle element paste;
   */
  const pasteTextClipboardData = (text: string, options?: PasteTextClipboardDataOptions) => {
    const onlySlide = options?.onlySlide || false
    const onlyElements = options?.onlyElements || false

    const clipboardData = pasteCustomClipboardString(text)

    // Element or slide
    if (typeof clipboardData === 'object') {
      const { type, data } = clipboardData

      if (type === 'elements' && !onlySlide) addElementsFromData(data)
      else if (type === 'slides' && !onlyElements) addSlidesFromData(data)
    }

    // Plain text
    else if (!onlyElements && !onlySlide) {
      // Plain text
      if (shiftKeyState.value) {
        const string = parseText2Paragraphs(clipboardData)
        createTextElementFromClipboard(string)
      }
      else {
        // Try to check whether it is an image URL link
        if (isValidImgURL(clipboardData)) {
          createImageElement(clipboardData)
        }
        // Try to check whether it is a hyperlink
        else if (isValidURL(clipboardData)) {
          createTextElementFromClipboard(`<a href="${clipboardData}" title="${clipboardData}" target="_blank">${clipboardData}</a>`)
        }
        // Try to check whether it is SVG code
        else if (isSVGString(clipboardData)) {
          const file = svg2File(clipboardData)
          getImageDataURL(file).then(dataURL => createImageElement(dataURL))
        }
        // Plain text
        else {
          const string = parseText2Paragraphs(clipboardData)
          createTextElementFromClipboard(string)
        }
      }
    }
  }

  return {
    pasteTextClipboardData,
  }
}