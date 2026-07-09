import { storeToRefs } from 'pinia'
import { useMainStore } from '@/store'
import { copyText, readClipboard } from '@/utils/clipboard'
import { encrypt } from '@/utils/crypto'
import message from '@/utils/message'
import usePasteTextClipboardData from '@/hooks/usePasteTextClipboardData'
import useDeleteElement from './useDeleteElement'

export default () => {
  const mainStore = useMainStore()
  const { activeElementIdList, activeElementList } = storeToRefs(mainStore)

  const { pasteTextClipboardData } = usePasteTextClipboardData()
  const { deleteElement } = useDeleteElement()

  // Encrypt the selected element data and copy it to the clipboard
  const copyElement = () => {
    if (!activeElementIdList.value.length) return

    const text = encrypt(JSON.stringify({
      type: 'elements',
      data: activeElementList.value,
    }))

    copyText(text).then(() => {
      mainStore.setEditorareaFocus(true)
    })
  }

  // Copy the selected elements then delete them (cut)
  const cutElement = () => {
    copyElement()
    deleteElement()
  }

  // Try to decrypt the clipboard element data and paste it
  const pasteElement = () => {
    readClipboard().then(text => {
      pasteTextClipboardData(text)
    }).catch(err => message.warning(err))
  }

  // Copy the selected elements and paste them immediately
  const quickCopyElement = () => {
    copyElement()
    pasteElement()
  }

  return {
    copyElement,
    cutElement,
    pasteElement,
    quickCopyElement,
  }
}