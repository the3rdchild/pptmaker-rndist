import { storeToRefs } from 'pinia'
import { useMainStore, useSlidesStore } from '@/store'
import type { PPTElement } from '@/types/slides'
import useHistorySnapshot from '@/hooks/useHistorySnapshot'

export default () => {
  const mainStore = useMainStore()
  const slidesStore = useSlidesStore()
  const { activeElementIdList, activeGroupElementId } = storeToRefs(mainStore)
  const { currentSlide } = storeToRefs(slidesStore)

  const { addHistorySnapshot } = useHistorySnapshot()

  // Delete all selected elements
  // Among the combined element members, if there is a selected element that can be operated independently, delete that element first. Otherwise, delete all selected elements by default
  const deleteElement = () => {
    if (!activeElementIdList.value.length) return

    let newElementList: PPTElement[] = []
    if (activeGroupElementId.value) {
      newElementList = currentSlide.value.elements.filter(el => el.id !== activeGroupElementId.value)
    }
    else {
      newElementList = currentSlide.value.elements.filter(el => !activeElementIdList.value.includes(el.id))
    }

    mainStore.setActiveElementIdList([])
    slidesStore.updateSlide({ elements: newElementList })
    addHistorySnapshot()
  }

  // Delete all elements on the slide (whether selected or not)
  const deleteAllElements = () => {
    if (!currentSlide.value.elements.length) return
    mainStore.setActiveElementIdList([])
    slidesStore.updateSlide({ elements: [] })
    addHistorySnapshot()
  }

  return {
    deleteElement,
    deleteAllElements,
  }
}