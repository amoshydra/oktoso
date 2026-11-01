import {
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
} from "@evenrealities/even_hub_sdk";

export const GLASS_WIDTH = 576;
export const GLASS_HEIGHT = 288;
export const FOOTER_Y = 246;
export const FOOTER_HEIGHT = 42;

export function textPage(
  body: string,
  footer: string,
  header?: string,
): RebuildPageContainer {
  const texts = [
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: GLASS_WIDTH,
      height: 36,
      borderWidth: 0,
      borderColor: 5,
      borderRadius: 0,
      paddingLength: 4,
      containerID: 1,
      containerName: "header",
      isEventCapture: 0,
      content: header ?? "OKTOSO",
    }),
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 38,
      width: GLASS_WIDTH,
      height: 204,
      borderWidth: 0,
      borderColor: 5,
      borderRadius: 4,
      paddingLength: 4,
      containerID: 2,
      containerName: "body",
      isEventCapture: 1,
      content: body,
    }),
    new TextContainerProperty({
      xPosition: 0,
      yPosition: FOOTER_Y,
      width: GLASS_WIDTH,
      height: FOOTER_HEIGHT,
      borderWidth: 0,
      borderColor: 5,
      borderRadius: 0,
      paddingLength: 4,
      containerID: 3,
      containerName: "footer",
      isEventCapture: 0,
      content: footer,
    }),
  ];
  return new RebuildPageContainer({ containerTotalNum: 3, textObject: texts });
}

export function listPage(
  header: string,
  items: string[],
  footer: string,
  body?: string,
): RebuildPageContainer {
  const headerHeight = 32;
  const bodyHeight = body ? 56 : 0;
  const bodyY = headerHeight;
  const listY = headerHeight + bodyHeight;
  const listHeight = 244 - listY;
  const texts = [
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: GLASS_WIDTH,
      height: headerHeight,
      borderWidth: 0,
      borderColor: 5,
      borderRadius: 0,
      paddingLength: 4,
      containerID: 1,
      containerName: "header",
      isEventCapture: 0,
      content: header,
    }),
  ];
  if (body) {
    texts.push(
      new TextContainerProperty({
        xPosition: 0,
        yPosition: bodyY,
        width: GLASS_WIDTH,
        height: bodyHeight,
        borderWidth: 0,
        borderColor: 5,
        borderRadius: 0,
        paddingLength: 4,
        containerID: 2,
        containerName: "summary",
        isEventCapture: 0,
        content: body,
      }),
    );
  }
  const list = new ListContainerProperty({
    xPosition: 0,
    yPosition: listY,
    width: GLASS_WIDTH,
    height: listHeight,
    borderWidth: 0,
    borderColor: 5,
    borderRadius: 4,
    paddingLength: 0,
    containerID: body ? 3 : 2,
    containerName: "list",
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: Math.max(1, items.length),
      itemWidth: 568,
      itemName: items.length ? items : ["(empty)"],
      isItemSelectBorderEn: 1,
    }),
  });
  texts.push(
    new TextContainerProperty({
      xPosition: 0,
      yPosition: FOOTER_Y,
      width: GLASS_WIDTH,
      height: FOOTER_HEIGHT,
      borderWidth: 0,
      borderColor: 5,
      borderRadius: 0,
      paddingLength: 4,
      containerID: 4,
      containerName: "footer",
      isEventCapture: 0,
      content: footer,
    }),
  );
  return new RebuildPageContainer({
    containerTotalNum: body ? 4 : 3,
    textObject: texts,
    listObject: [list],
  });
}
