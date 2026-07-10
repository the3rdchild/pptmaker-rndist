import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore } from '@/store'

export default () => {
  const mainStore = useMainStore()
  const { canvasPercentage, canvasScale, canvasDragged } = storeToRefs(mainStore)

  const canvasScalePercentage = computed(() => Math.round(canvasScale.value * 100) + '%')

  /**
   * Scale the canvas percentage
   * @param command Scale command: zoom in, zoom out
   */
  const scaleCanvas = (command: '+' | '-') => {
    let percentage = canvasPercentage.value
    const step = 5
    const max = 200
    const min = 30
    if (command === '+' && percentage <= max) percentage += step
    if (command === '-' && percentage >= min) percentage -= step

    mainStore.setCanvasPercentage(percentage)
  }

  /**
   * Set the canvas scale percentage
   * But instead of setting this value directly, it is calculated dynamically by setting the percentage of the canvas viewport
   * @param value Target canvas scale percentage
   */
  const setCanvasScalePercentage = (value: number) => {
    const percentage = Math.round(value / canvasScale.value * canvasPercentage.value) / 100
    mainStore.setCanvasPercentage(percentage)
  }

  /**
   * Reset the canvas size and position
   */
  const resetCanvas = () => {
    mainStore.setCanvasPercentage(90)
    if (canvasDragged) mainStore.setCanvasDragged(false)
  }

  return {
    canvasScalePercentage,
    setCanvasScalePercentage,
    scaleCanvas,
    resetCanvas,
  }
}