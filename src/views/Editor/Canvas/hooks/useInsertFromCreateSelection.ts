import type { ShallowRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore } from '@/store'
import type { CreateElementSelectionData } from '@/types/edit'
import useCreateElement from '@/hooks/useCreateElement'

export default (viewportRef: ShallowRef<HTMLElement | null>) => {
  const mainStore = useMainStore()
  const { canvasScale, creatingElement } = storeToRefs(mainStore)

  // Compute the selection's position and size based on the start and end points of the mouse selection
  const formatCreateSelection = (selectionData: CreateElementSelectionData) => {
    const { start, end } = selectionData

    if (!viewportRef.value) return
    const viewportRect = viewportRef.value.getBoundingClientRect()

    const [startX, startY] = start
    const [endX, endY] = end
    const minX = Math.min(startX, endX)
    const maxX = Math.max(startX, endX)
    const minY = Math.min(startY, endY)
    const maxY = Math.max(startY, endY)

    const left = (minX - viewportRect.x) / canvasScale.value
    const top = (minY - viewportRect.y) / canvasScale.value
    const width = (maxX - minX) / canvasScale.value
    const height = (maxY - minY) / canvasScale.value

    return { left, top, width, height }
  }

  // Compute the line's position in the canvas and its start/end points based on the start and end points of the mouse selection
  const formatCreateSelectionForLine = (selectionData: CreateElementSelectionData) => {
    const { start, end } = selectionData

    if (!viewportRef.value) return
    const viewportRect = viewportRef.value.getBoundingClientRect()

    const [startX, startY] = start
    const [endX, endY] = end
    const minX = Math.min(startX, endX)
    const maxX = Math.max(startX, endX)
    const minY = Math.min(startY, endY)
    const maxY = Math.max(startY, endY)

    const left = (minX - viewportRect.x) / canvasScale.value
    const top = (minY - viewportRect.y) / canvasScale.value
    const width = (maxX - minX) / canvasScale.value
    const height = (maxY - minY) / canvasScale.value

    const _start: [number, number] = [
      startX === minX ? 0 : width,
      startY === minY ? 0 : height,
    ]
    const _end: [number, number] = [
      endX === minX ? 0 : width,
      endY === minY ? 0 : height,
    ]

    return {
      left,
      top,
      start: _start,
      end: _end,
    }
  }

  const { createTextElement, createShapeElement, createLineElement } = useCreateElement()

  // Insert element based on the position and size of the mouse selection
  const insertElementFromCreateSelection = (selectionData: CreateElementSelectionData) => {
    if (!creatingElement.value) return

    const type = creatingElement.value.type
    if (type === 'text') {
      const position = formatCreateSelection(selectionData)
      position && createTextElement(position, { vertical: creatingElement.value.vertical })
    }
    else if (type === 'shape') {
      const position = formatCreateSelection(selectionData)
      position && createShapeElement(position, creatingElement.value.data)
    }
    else if (type === 'line') {
      const position = formatCreateSelectionForLine(selectionData)
      position && createLineElement(position, creatingElement.value.data)
    }
    mainStore.setCreatingElement(null)
  }

  return {
    formatCreateSelection,
    insertElementFromCreateSelection,
  }
}