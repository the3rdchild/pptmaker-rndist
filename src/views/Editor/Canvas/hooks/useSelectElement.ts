import type { Ref } from 'vue'
import { uniq } from 'lodash'
import { storeToRefs } from 'pinia'
import { useMainStore, useKeyboardStore } from '@/store'
import type { PPTElement } from '@/types/slides'

export default (
  elementList: Ref<PPTElement[]>,
  moveElement: (e: MouseEvent | TouchEvent, element: PPTElement) => void,
) => {
  const mainStore = useMainStore()
  const { activeElementIdList, activeGroupElementId, handleElementId, editorAreaFocus } = storeToRefs(mainStore)
  const { ctrlKeyState, ctrlOrShiftKeyActive } = storeToRefs(useKeyboardStore())

  // Select element
  // startMove indicates whether to enter the start-moving state after the selection operation
  const selectElement = (e: MouseEvent | TouchEvent, element: PPTElement, startMove = true) => {
    if (!editorAreaFocus.value) mainStore.setEditorareaFocus(true)

    // If the target element is not currently selected, set it to selected state
    // At this point, if the Ctrl or Shift key is pressed, enter multi-select state and set both the currently selected elements and the target element to selected; otherwise only set the target element to selected
    // If the target element is a group member, the other elements of that group need to be set to selected together
    if (!activeElementIdList.value.includes(element.id)) {
      let newActiveIdList: string[] = []

      if (ctrlOrShiftKeyActive.value) {
        newActiveIdList = [...activeElementIdList.value, element.id]
      }
      else newActiveIdList = [element.id]
      
      if (element.groupId) {
        const groupMembersId: string[] = []
        elementList.value.forEach((el: PPTElement) => {
          if (el.groupId === element.groupId) groupMembersId.push(el.id)
        })
        newActiveIdList = [...newActiveIdList, ...groupMembersId]
      }

      mainStore.setActiveElementIdList(uniq(newActiveIdList))
      mainStore.setHandleElementId(element.id)
    }

    // When Ctrl is pressed on an already-selected element and dragging is allowed, do not deselect immediately
    // Because Ctrl+click and Ctrl+drag-copy share the same mousedown
    // So we first record the pressed position, and decide on mouseup whether this operation is a "click" or a "drag"
    // On click, deselect on mouseup; on drag, let the drag logic handle it
    else if (ctrlKeyState.value && startMove) {
      const startPageX = e instanceof MouseEvent ? e.pageX : e.changedTouches[0].pageX
      const startPageY = e instanceof MouseEvent ? e.pageY : e.changedTouches[0].pageY
      const target = e.target as HTMLElement

      target.onmouseup = (e: MouseEvent) => {
        const currentPageX = e.pageX
        const currentPageY = e.pageY

        if (startPageX === currentPageX && startPageY === currentPageY) {
          let newActiveIdList: string[] = []

          if (element.groupId) {
            const groupMembersId: string[] = []
            elementList.value.forEach((el: PPTElement) => {
              if (el.groupId === element.groupId) groupMembersId.push(el.id)
            })
            newActiveIdList = activeElementIdList.value.filter(id => !groupMembersId.includes(id))
          }
          else {
            newActiveIdList = activeElementIdList.value.filter(id => id !== element.id)
          }

          if (newActiveIdList.length > 0) {
            mainStore.setActiveElementIdList(newActiveIdList)
          }
        }
        target.onmouseup = null
      }
    }

    // If the target element is already selected and the Ctrl or Shift key is pressed, deselect it
    // Unless the target element is the last selected element, or the group containing the target element is the last selected group
    // If the target element is a group member, the other elements of that group also need to be deselected together
    else if (ctrlOrShiftKeyActive.value) {
      let newActiveIdList: string[] = []

      if (element.groupId) {
        const groupMembersId: string[] = []
        elementList.value.forEach((el: PPTElement) => {
          if (el.groupId === element.groupId) groupMembersId.push(el.id)
        })
        newActiveIdList = activeElementIdList.value.filter(id => !groupMembersId.includes(id))
      }
      else {
        newActiveIdList = activeElementIdList.value.filter(id => id !== element.id)
      }

      if (newActiveIdList.length > 0) {
        mainStore.setActiveElementIdList(newActiveIdList)
      }
    }

    // If the target element is already selected and is not the currently operated element, set it as the currently operated element
    else if (handleElementId.value !== element.id) {
      mainStore.setHandleElementId(element.id)
    }

    // If the target element is already selected and is also the currently operated element, then when the target element is clicked again in this state, it will be set as the activated member of the multi-selected elements
    else if (activeGroupElementId.value !== element.id) {
      const startPageX = e instanceof MouseEvent ? e.pageX : e.changedTouches[0].pageX
      const startPageY = e instanceof MouseEvent ? e.pageY : e.changedTouches[0].pageY

      ;(e.target as HTMLElement).onmouseup = (e: MouseEvent) => {
        const currentPageX = e.pageX
        const currentPageY = e.pageY

        if (startPageX === currentPageX && startPageY === currentPageY) {
          mainStore.setActiveGroupElementId(element.id)
          ;(e.target as HTMLElement).onmouseup = null
        }
      }
    }

    if (startMove) moveElement(e, element)
  }

  return {
    selectElement,
  }
}
