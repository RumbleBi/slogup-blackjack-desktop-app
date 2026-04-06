import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

function Greeting({ name }: { name: string }) {
  return <h1>안녕하세요, {name}!</h1>
}

describe('Greeting', () => {
  it('이름을 렌더링한다', () => {
    render(<Greeting name="블랙잭" />)
    expect(screen.getByText('안녕하세요, 블랙잭!')).toBeInTheDocument()
  })
})
