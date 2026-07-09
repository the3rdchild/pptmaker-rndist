import type { PPTShapeElement } from '@/types/slides'
import { computed, type Ref } from 'vue'

// Calculate the element's fill style
export default (element: Ref<PPTShapeElement>, source: string) => {
  const fill = computed(() => {
    if (element.value.pattern) return `url(#${source}-pattern-${element.value.id})`
    if (element.value.gradient) return `url(#${source}-gradient-${element.value.id})`
    return element.value.fill || 'none'
  })

  return {
    fill,
  }
}