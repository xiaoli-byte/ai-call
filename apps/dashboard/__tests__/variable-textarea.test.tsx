import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VariableTextArea } from '../components/flow-builder/forms/variable-textarea';

const variables = [
  {
    key: 'customer_name',
    label: '客户姓名',
    description: '用于称呼客户',
  },
  {
    key: 'amount_due',
    label: '应还金额',
  },
];

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <VariableTextArea
        aria-label="话术文本"
        value={value}
        variables={variables}
        onValueChange={setValue}
      />
      <output data-testid="serialized-value">{value}</output>
    </>
  );
}

describe('VariableTextArea', () => {
  it('opens global variable suggestions after typing ${ and inserts the selected token', () => {
    render(<Harness />);

    const editor = screen.getByLabelText('话术文本');
    editor.textContent = '您好 ${';
    fireEvent.input(editor);

    const option = screen.getByRole('option', { name: /客户姓名/ });
    expect(option).toBeTruthy();

    fireEvent.mouseDown(option);

    expect(screen.getByText('客户姓名')).toBeTruthy();
    expect(screen.getByTestId('serialized-value').textContent).toBe('您好 ${customer_name}');
  });
});
