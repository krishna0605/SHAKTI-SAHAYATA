import '@testing-library/jest-dom'

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]

  disconnect() {}
  observe() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  unobserve() {}
}

Object.defineProperty(globalThis, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
})

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  writable: true,
  configurable: true,
  value: () => {},
})
