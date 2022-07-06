import React from "react";
import {
	SideSheet,
	SideSheetProps,
	Button,
	CrossIcon,
	majorScale,
	Strong,
	Pane
} from "evergreen-ui";
import { css } from "@linaria/core";
import * as mediaQueries from "@/utils/media-queries";

const MobileFriendlySideSheet: React.FC<SideSheetProps> = ({
	children,
	...props
}) => {
	return (
		<SideSheet
			{...props}
			containerProps={{
				...props.containerProps,
				position: "relative",
				maxWidth: "100%"
			}}
		>
			{children}
			<Pane
				position="fixed"
				bottom={50}
				left={0}
				right={0}
				display="flex"
				alignItems="center"
				justifyContent="center"
				className={css`
					${mediaQueries.gtMedium} {
						display: none !important;
					}
				`}
				zIndex={99}
			>
				<Button
					onClick={props.onCloseComplete}
					borderRadius={100}
					height={majorScale(7)}
					iconAfter={() => <CrossIcon size={22} />}
					appearance="minimal"
					backgroundColor="rgba(0, 0, 0, 0.1)"
					opacity={0.75}
					minWidth={150}
				>
					<Strong fontSize="1.2em">Close</Strong>
				</Button>
			</Pane>
		</SideSheet>
	);
};

export default MobileFriendlySideSheet;
