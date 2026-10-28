import { Component, Show, createMemo } from 'solid-js';
import { MarkdownElement } from '../../types/model';
import { store } from '../../runtime/store';
import { isTemplate, renderTemplate } from '../../runtime/template';
import { parseMarkdown } from '../../runtime/markdown';

export const MarkdownWidget: Component<{ element: MarkdownElement }> = (props) => {
  const text = () => props.element.content || '';
  const templated = () => isTemplate(text());

  // the template fills {{ }} from the tables first (after the filters); the result is then ordinary Markdown.
  const rendered = createMemo(() => (templated() ? renderTemplate(text(), store.templateVars(props.element)) : undefined));
  const html = createMemo(() => parseMarkdown(rendered()?.output ?? text()));
  const error = () => rendered()?.error;

  return (
    <div class="d-markdown-widget">
      {props.element.title && <div class="markdown-title">{props.element.title}</div>}
      <Show when={error()}>
        <div class="d-template-error" title={error()}>Template: {error()}</div>
      </Show>
      <Show when={text() || !store.editing()} fallback={<div class="d-chart-empty">Write text in the Build tab</div>}>
        <div
          class="markdown-content"
          style={{ 'font-size': props.element.textSize ? `${props.element.textSize}px` : undefined, 'text-align': props.element.align }}
          innerHTML={html()}
        />
      </Show>
    </div>
  );
};
